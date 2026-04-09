import { logger } from "../utils/logger";
import { formatAmount, parseAmount } from "../utils/format";
import type { CircleClient } from "../chain/circle";
import type { TokenOps, TokenSymbol } from "../chain/tokens";
import type { ArcRouter } from "../chain/router";
import type { WalletStore } from "../store/wallets";
import type { VendorStore } from "../store/vendors";
import type { PendingPaymentStore, PendingPayment, PaymentSource } from "../store/pending";
import type { SubmittedTxStore, SubmittedTx } from "../store/submitted";
import type { PaymentLogStore } from "../store/payments";
import type { ConversationMemory } from "../memory/conversation";
import { getConfig } from "../config";
import { DEFAULT_PAYMENT_MEMO, arcExplorerTx } from "../constants";
import { generateReceipt } from "../utils/receipt";
import crypto from "crypto";

const PAYMENT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export interface PaymentEngineDeps {
    circle: CircleClient;
    tokens: TokenOps;
    router: ArcRouter;
    wallets: WalletStore;
    vendors: VendorStore;
    pending: PendingPaymentStore;
    submitted: SubmittedTxStore;
    paymentLog: PaymentLogStore;
    memory: ConversationMemory;
    sendCard: (chatId: number, text: string, keyboard: any[][]) => Promise<void>;
    send: (chatId: number, text: string) => Promise<void>;
    sendDocument: (chatId: number, buffer: Buffer, filename: string, caption?: string, contentType?: string) => Promise<void>;
}

export class PaymentEngine {
    private deps: PaymentEngineDeps;

    constructor(deps: PaymentEngineDeps) {
        this.deps = deps;
    }

    /**
     * Prepare a payment: validate, store pending, send confirmation card.
     * This is the ONLY sender for create_payment — orchestrator NEVER sends LLM message.
     */
    async prepare(
        chatId: number,
        beneficiary: string,
        amount: number,
        token: TokenSymbol = "USDC",
        memo: string | null = null,
        source?: PaymentSource,
    ): Promise<void> {
        const walletId = await this.deps.wallets.getWalletId(chatId);
        if (!walletId) {
            await this.deps.send(chatId, "You need a wallet first. Say \"create wallet\" to get started.");
            return;
        }

        // Resolve beneficiary: vendor name or raw address
        let address = beneficiary;
        let vendorName: string | null = null;

        if (!beneficiary.startsWith("0x")) {
            const found = await this.deps.vendors.findVendor(chatId, beneficiary);
            if (!found) {
                await this.deps.send(chatId, `I couldn't find a vendor named "${beneficiary}". Please provide a wallet address or save the vendor first.`);
                return;
            }
            address = found.data.address;
            vendorName = found.data.displayName;
        }

        // Self-payment check
        const myAddress = await this.deps.wallets.getWalletAddress(chatId);
        if (myAddress && address.toLowerCase() === myAddress.toLowerCase()) {
            await this.deps.send(chatId, "You can't send a payment to your own wallet.");
            return;
        }

        const amountStr = amount.toFixed(2);
        const amountBigint = parseAmount(amountStr);

        const pending: PendingPayment = {
            beneficiary: address,
            vendorName,
            amountStr,
            amount: amountBigint.toString(),
            memo,
            token,
            createdAt: Date.now(),
            source,
        };

        await this.deps.pending.set(chatId, pending);
        this.deps.memory.setFlowState(chatId, { status: "awaiting_confirmation", since: Date.now() });

        const displayTo = vendorName || address;
        const cardText = `Payment Review\n\nTo: ${displayTo}\nAmount: ${amountStr} ${token}${memo ? `\nMemo: ${memo}` : ""}\n\nPlease confirm or cancel using the buttons below.`;

        const keyboard = [
            [
                { text: "Confirm", callback_data: "payment_confirm" },
                { text: "Cancel", callback_data: "payment_cancel" },
            ],
        ];

        await this.deps.sendCard(chatId, cardText, keyboard);

        logger.info(chatId, "[PaymentEngine] Payment prepared", { address, amountStr, token });
    }

    /**
     * Handle callback from Confirm/Cancel buttons.
     */
    async processCallback(chatId: number, action: "confirm" | "cancel"): Promise<void> {
        const pending = await this.deps.pending.get(chatId);

        if (!pending) {
            await this.deps.send(chatId, "No pending payment found.");
            this.deps.memory.clearFlowState(chatId);
            return;
        }

        if (action === "cancel") {
            await this.deps.pending.clear(chatId);
            this.deps.memory.clearFlowState(chatId);
            await this.deps.send(chatId, "Payment cancelled.");
            logger.info(chatId, "[PaymentEngine] Payment cancelled by user");
            return;
        }

        // Confirm → execute
        await this.execute(chatId, pending);
    }

    /**
     * Execute the payment on-chain via Circle.
     */
    private async execute(chatId: number, payment: PendingPayment): Promise<void> {
        const walletId = await this.deps.wallets.getWalletId(chatId);
        if (!walletId) {
            await this.deps.send(chatId, "Wallet not found. Please create a wallet first.");
            return;
        }

        const walletAddress = await this.deps.wallets.getWalletAddress(chatId);
        if (!walletAddress) {
            await this.deps.send(chatId, "Wallet address not found.");
            return;
        }

        const amount = BigInt(payment.amount);
        const token = payment.token;

        // Check balance
        try {
            const balance = await this.deps.tokens.balanceOf(token, walletAddress);
            if (balance < amount) {
                const balStr = formatAmount(balance);
                await this.deps.send(chatId, `Insufficient ${token} balance. You have ${balStr} ${token} but need ${payment.amountStr} ${token}.`);
                await this.deps.pending.clear(chatId);
                this.deps.memory.clearFlowState(chatId);
                return;
            }
        } catch (err: any) {
            logger.warn(chatId, "[PaymentEngine] Balance check failed, proceeding", { error: err.message });
        }

        await this.deps.send(chatId, `Processing payment of ${payment.amountStr} ${token}...`);

        const idempotencyApprove = crypto.randomUUID();
        const idempotencyPay = crypto.randomUUID();
        const config = getConfig();

        try {
            // Step 1: Approve router to spend tokens
            const tokenAddress = this.deps.tokens.getAddress(token);
            const approveData = this.deps.tokens.encodeApprove(token, this.deps.router.address, amount);

            const approveTx: SubmittedTx = {
                chatId,
                txId: "",
                idempotencyKey: idempotencyApprove,
                status: "creating",
                context: "approval",
                walletId,
                beneficiary: payment.beneficiary,
                vendorName: payment.vendorName,
                amountStr: payment.amountStr,
                amount: payment.amount,
                memo: payment.memo,
                token,
                source: payment.source,
                submittedAt: Date.now(),
            };
            await this.deps.submitted.set(approveTx);

            const approveTxId = await this.deps.circle.submitTx(walletId, tokenAddress, approveData, idempotencyApprove);
            approveTx.txId = approveTxId;
            approveTx.status = "submitted";
            await this.deps.submitted.set(approveTx);

            const approveResult = await this.deps.circle.pollTx(approveTxId);
            if (approveResult.state !== "COMPLETE") {
                await this.deps.send(chatId, `Approval failed: ${approveResult.errorReason || approveResult.state}. Please try again.`);
                await this.cleanup(chatId);
                return;
            }

            // Step 2: Execute payment via router
            const memo = payment.memo || DEFAULT_PAYMENT_MEMO;
            const payData = this.deps.router.encodePay(payment.beneficiary, amount, memo);

            const payTx: SubmittedTx = {
                chatId,
                txId: "",
                idempotencyKey: idempotencyPay,
                status: "creating",
                context: "payment",
                walletId,
                beneficiary: payment.beneficiary,
                vendorName: payment.vendorName,
                amountStr: payment.amountStr,
                amount: payment.amount,
                memo: payment.memo,
                token,
                source: payment.source,
                submittedAt: Date.now(),
            };
            await this.deps.submitted.set(payTx);

            const payTxId = await this.deps.circle.submitTx(walletId, this.deps.router.address, payData, idempotencyPay);
            payTx.txId = payTxId;
            payTx.status = "submitted";
            await this.deps.submitted.set(payTx);

            const payResult = await this.deps.circle.pollTx(payTxId);
            if (payResult.state !== "COMPLETE") {
                await this.deps.send(chatId, `Payment failed: ${payResult.errorReason || payResult.state}. Please try again.`);
                await this.cleanup(chatId);
                return;
            }

            // Success
            const displayTo = payment.vendorName || payment.beneficiary;
            const explorerUrl = arcExplorerTx(payResult.txHash || "");
            await this.deps.send(chatId, `Payment of ${payment.amountStr} ${token} to ${displayTo} completed.\n\nTx: ${explorerUrl}`);

            // Auto-send PDF receipt (non-blocking — receipt failure must never affect payment)
            try {
                const receipt = await generateReceipt({
                    vendor: payment.vendorName || payment.beneficiary,
                    address: payment.beneficiary,
                    amount: payment.amountStr,
                    token,
                    txHash: payResult.txHash || undefined,
                    memo: payment.memo || undefined,
                    timestamp: Date.now(),
                });
                await this.deps.sendDocument(chatId, receipt, "receipt.pdf", "Payment receipt", "application/pdf");
            } catch { /* receipt failure is non-fatal */ }

            // Log payment
            await this.deps.paymentLog.logPayment(chatId, {
                vendor: payment.vendorName || payment.beneficiary,
                address: payment.beneficiary,
                amount: parseFloat(payment.amountStr),
                token,
                timestamp: Date.now(),
                memo: payment.memo || undefined,
                txHash: payResult.txHash || undefined,
            });

            // Update vendor stats
            if (payment.vendorName) {
                await this.deps.vendors.recordPayment(chatId, payment.vendorName, parseFloat(payment.amountStr));
            }

            // Update memory
            this.deps.memory.setLastPayment(chatId, displayTo, payment.amountStr, token);

            logger.info(chatId, "[PaymentEngine] Payment complete", {
                txHash: payResult.txHash,
                amount: payment.amountStr,
                token,
                to: displayTo,
            });
        } catch (err: any) {
            logger.error(chatId, "[PaymentEngine] Payment execution error", { error: err.message });
            await this.deps.send(chatId, `Payment failed: ${err.message}. Please try again.`);
        } finally {
            await this.cleanup(chatId);
        }
    }

    /**
     * Clean up pending and submitted state, reset flow.
     */
    private async cleanup(chatId: number): Promise<void> {
        await this.deps.pending.clear(chatId);
        await this.deps.submitted.clear(chatId);
        this.deps.memory.clearFlowState(chatId);
    }

    /**
     * Reconcile in-flight transactions on startup.
     */
    async reconcile(): Promise<void> {
        const inflight = await this.deps.submitted.listAll();
        for (const tx of inflight) {
            if (!tx.txId) {
                await this.deps.submitted.clear(tx.chatId);
                continue;
            }

            try {
                const result = await this.deps.circle.getTx(tx.txId);
                if (result.state === "COMPLETE") {
                    logger.info(tx.chatId, "[PaymentEngine] Reconciled completed tx", { txId: tx.txId });
                    if (tx.context === "payment") {
                        await this.deps.paymentLog.logPayment(tx.chatId, {
                            vendor: tx.vendorName || tx.beneficiary,
                            address: tx.beneficiary,
                            amount: parseFloat(tx.amountStr),
                            token: tx.token,
                            timestamp: Date.now(),
                            memo: tx.memo || undefined,
                            txHash: result.txHash || undefined,
                        });
                    }
                } else if (result.state !== "PENDING") {
                    logger.warn(tx.chatId, "[PaymentEngine] Reconciled failed tx", { txId: tx.txId, state: result.state });
                }
                await this.deps.submitted.clear(tx.chatId);
                await this.deps.pending.clear(tx.chatId);
                this.deps.memory.clearFlowState(tx.chatId);
            } catch (err: any) {
                logger.warn(tx.chatId, "[PaymentEngine] Reconcile error", { error: err.message });
            }
        }
    }

    /**
     * Expire old pending payments (>30 min).
     */
    async expireOld(): Promise<void> {
        const all = await this.deps.pending.listAll();
        const now = Date.now();
        for (const { chatId, payment } of all) {
            if (now - payment.createdAt > PAYMENT_EXPIRY_MS) {
                await this.deps.pending.clear(chatId);
                this.deps.memory.clearFlowState(chatId);
                logger.info(chatId, "[PaymentEngine] Expired stale pending payment");
            }
        }
    }
}
