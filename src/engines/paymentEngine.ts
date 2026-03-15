import { ethers } from "ethers";
import { randomUUID } from "crypto";
import TelegramBot from "node-telegram-bot-api";
import { USDC } from "../blockchain/usdc";
import { ArcRouter } from "../blockchain/arcRouter";
import { WalletStore } from "../storage/walletStore";
import { VendorStore } from "../storage/vendorStore";
import { PaymentLogStore } from "../storage/paymentLogs";
import { CircleClient, CircleTransactionStatus } from "../blockchain/circleClient";
import { SessionStore } from "../agent/sessionStore";
import { MemoryStore } from "../ai/memoryStore";
import { PendingPaymentSource, PendingPaymentStore } from "../storage/pendingPayments";
import { SubmittedTransactionContext, SubmittedTransactionRecord, SubmittedTransactionStatus, SubmittedTransactionStore } from "../storage/submittedTransactions";
import { getArcGasReserveUsdc, getExpectedArcChainId } from "../blockchain/arcConfig";

export interface PendingPayment {
    beneficiary: string;
    vendorName: string | null;
    amountStr: string;
    amount: bigint;
    memo: string | null;
    onConfirmed?: () => void;
    source?: PendingPaymentSource;
}

type ExecutionState = "prepared" | "submitted" | "confirmed" | "failed";

export class PaymentEngine {
    private pendingPay: Record<string, PendingPayment> = {};
    private processingChats: Set<string> = new Set();

    constructor(
        private bot: TelegramBot,
        private usdc: USDC,
        private router: ArcRouter,
        private routerAddress: string,
        private walletStore: WalletStore,
        private vendorStore: VendorStore,
        private provider: ethers.Provider,
        private paymentLogs: PaymentLogStore,
        private circleClient: CircleClient,
        private sessionStore?: SessionStore,
        private memoryStore?: MemoryStore,
        private pendingPaymentStore?: PendingPaymentStore,
        private submittedTransactionStore?: SubmittedTransactionStore,
        private postConfirmHandler?: (chatId: number, payment: PendingPayment) => void
    ) { }

    private persistPendingPayment(chatId: number, payment: PendingPayment): void {
        this.pendingPaymentStore?.setPendingPayment(chatId, {
            beneficiary: payment.beneficiary,
            vendorName: payment.vendorName,
            amountStr: payment.amountStr,
            amount: payment.amount.toString(),
            memo: payment.memo,
            source: payment.source
        });
    }

    private hydratePendingPayment(chatId: number): PendingPayment | null {
        const restored = this.pendingPaymentStore?.getPendingPayment(chatId);
        if (!restored) {
            return null;
        }

        const payment: PendingPayment = {
            beneficiary: restored.beneficiary,
            vendorName: restored.vendorName,
            amountStr: restored.amountStr,
            amount: BigInt(restored.amount),
            memo: restored.memo,
            source: restored.source
        };

        this.pendingPay[chatId.toString()] = payment;
        return payment;
    }

    private createSubmittedRecord(
        chatId: number,
        walletId: string,
        payment: PendingPayment,
        context: SubmittedTransactionContext,
        options?: { txId?: string | null; idempotencyKey?: string; status?: SubmittedTransactionStatus }
    ): SubmittedTransactionRecord {
        return {
            chatId,
            txId: options?.txId ?? null,
            idempotencyKey: options?.idempotencyKey ?? randomUUID(),
            status: options?.status ?? "creating",
            context,
            walletId,
            beneficiary: payment.beneficiary,
            vendorName: payment.vendorName,
            amountStr: payment.amountStr,
            amount: payment.amount.toString(),
            memo: payment.memo,
            source: payment.source,
            submittedAt: Date.now()
        };
    }

    private createSubmissionAttempt(chatId: number, walletId: string, payment: PendingPayment, context: SubmittedTransactionContext): SubmittedTransactionRecord {
        const record = this.createSubmittedRecord(chatId, walletId, payment, context);
        this.submittedTransactionStore?.set(record);
        return record;
    }

    private markSubmittedTransaction(record: SubmittedTransactionRecord, txId: string): SubmittedTransactionRecord {
        const updatedRecord: SubmittedTransactionRecord = {
            ...record,
            txId,
            status: "submitted"
        };
        this.submittedTransactionStore?.set(updatedRecord);
        return updatedRecord;
    }

    private clearSubmittedTransaction(chatId: number): void {
        this.submittedTransactionStore?.clear(chatId);
    }

    private getSubmittedTransaction(chatId: number): SubmittedTransactionRecord | null {
        return this.submittedTransactionStore?.get(chatId) || null;
    }

    private rehydrateSubmittedPayment(record: SubmittedTransactionRecord): PendingPayment {
        return {
            beneficiary: record.beneficiary,
            vendorName: record.vendorName,
            amountStr: record.amountStr,
            amount: BigInt(record.amount),
            memo: record.memo,
            source: record.source
        };
    }

    private getTransactionPayload(record: SubmittedTransactionRecord): { contractAddress: string; encodedData: string } {
        const payment = this.rehydrateSubmittedPayment(record);

        if (record.context === "approval") {
            return {
                contractAddress: this.usdc.getAddress(),
                encodedData: this.usdc.encodeApprove(this.routerAddress, payment.amount)
            };
        }

        return {
            contractAddress: this.routerAddress,
            encodedData: this.router.encodePay(payment.beneficiary, payment.amount, payment.memo || "")
        };
    }

    private async ensureSubmittedRecord(record: SubmittedTransactionRecord): Promise<SubmittedTransactionRecord> {
        if (record.txId && record.status === "submitted") {
            return record;
        }

        const payload = this.getTransactionPayload(record);
        const txId = await this.circleClient.createTransaction(
            record.walletId,
            payload.contractAddress,
            payload.encodedData,
            record.idempotencyKey
        );

        return this.markSubmittedTransaction(record, txId);
    }

    private getProcessingKey(chatId: number): string {
        return chatId.toString();
    }

    private beginProcessing(chatId: number): boolean {
        const key = this.getProcessingKey(chatId);
        if (this.processingChats.has(key)) {
            return false;
        }

        this.processingChats.add(key);
        return true;
    }

    private endProcessing(chatId: number): void {
        this.processingChats.delete(this.getProcessingKey(chatId));
    }

    private getPollingConfig(): { attempts: number; intervalMs: number } {
        const attempts = Number.parseInt(process.env.CIRCLE_TX_POLL_ATTEMPTS || "", 10);
        const intervalMs = Number.parseInt(process.env.CIRCLE_TX_POLL_INTERVAL_MS || "", 10);

        return {
            attempts: Number.isInteger(attempts) && attempts > 0 ? attempts : 15,
            intervalMs: Number.isInteger(intervalMs) && intervalMs > 0 ? intervalMs : 2000
        };
    }

    private describeFailure(status: CircleTransactionStatus): string {
        const reason = status.errorReason || status.state;
        const details = status.errorDetails ? ` (${status.errorDetails})` : "";
        return `${reason}${details}`;
    }

    private async validateArcNetwork(): Promise<string | null> {
        try {
            const network = await this.provider.getNetwork();
            const expectedChainId = getExpectedArcChainId();

            if (network.chainId !== expectedChainId) {
                return `⚠️ **Arc network mismatch**\n\nExpected chain ID: \`${expectedChainId.toString()}\`\nConnected chain ID: \`${network.chainId.toString()}\`\n\nPayments are blocked until the Arc RPC configuration is fixed.`;
            }

            return null;
        } catch (error) {
            console.error("[Payment] Failed to verify Arc network:", error);
            return "⚠️ I couldn't verify the Arc network right now. Please try again in a moment.";
        }
    }

    private async waitForFinalCircleState(txId: string): Promise<CircleTransactionStatus | null> {
        const polling = this.getPollingConfig();
        try {
            return await this.circleClient.waitForTerminalTransaction(txId, polling);
        } catch (error) {
            console.error(`[Payment] Failed to poll Circle transaction ${txId}:`, error);
            return null;
        }
    }

    private finalizePayment(chatId: number, payment: PendingPayment, txId: string): void {
        if (payment.vendorName) {
            this.vendorStore.recordPayment(chatId, payment.vendorName, parseFloat(payment.amountStr));
        }

        if (this.memoryStore) {
            this.memoryStore.recordPayment(chatId, payment.vendorName || payment.beneficiary, parseFloat(payment.amountStr));
        }

        if (this.paymentLogs) {
            this.paymentLogs.logPayment(chatId, {
                vendor: payment.vendorName,
                address: payment.beneficiary,
                amount: parseFloat(payment.amountStr),
                timestamp: Date.now(),
                memo: payment.memo || "",
                txHash: txId
            });
        }
    }

    private clearPendingPayment(chatId: number): void {
        delete this.pendingPay[chatId.toString()];
        this.pendingPaymentStore?.clearPendingPayment(chatId);
        if (this.sessionStore) this.sessionStore.clearPendingState(chatId);
    }

    private async resolveSubmittedTransaction(
        chatId: number,
        payment: PendingPayment,
        txId: string,
        context: "approval" | "payment"
    ): Promise<ExecutionState> {
        const finalStatus = await this.waitForFinalCircleState(txId);

        if (!finalStatus) {
            if (context === "approval") {
                this.bot.sendMessage(
                    chatId,
                    `⏳ Approval submitted to Circle.\n\nCircle TxID: \`${txId}\`\nStatus: waiting for final confirmation.\nI’ll continue automatically when Circle reaches a final state.`,
                    { parse_mode: "Markdown" }
                );
                return "submitted";
            }

            this.bot.sendMessage(
                chatId,
                `⏳ **Payment submitted**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${txId}\`\n\nCircle is processing the transaction. I’ll update you when it reaches a final status.`,
                { parse_mode: "Markdown" }
            );
            this.clearPendingPayment(chatId);
            return "submitted";
        }

        if (this.circleClient.isSuccessfulTerminalState(finalStatus.state)) {
            this.clearSubmittedTransaction(chatId);
            if (context === "approval") {
                return "confirmed";
            }

            this.bot.sendMessage(
                chatId,
                `✅ **Payment confirmed**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${txId}\``,
                { parse_mode: "Markdown" }
            );
            this.finalizePayment(chatId, payment, txId);
            payment.onConfirmed?.();
            this.postConfirmHandler?.(chatId, payment);
            this.clearPendingPayment(chatId);
            return "confirmed";
        }

        if (context === "approval") {
            this.clearSubmittedTransaction(chatId);
            this.bot.sendMessage(
                chatId,
                `❌ Approval failed on Circle.\n\nCircle TxID: \`${txId}\`\nReason: ${this.describeFailure(finalStatus)}`,
                { parse_mode: "Markdown" }
            );
            return "failed";
        }

        this.clearSubmittedTransaction(chatId);
        this.bot.sendMessage(
            chatId,
            `❌ **Payment failed**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${txId}\`\nReason: ${this.describeFailure(finalStatus)}`,
            { parse_mode: "Markdown" }
        );
        this.clearPendingPayment(chatId);
        return "failed";
    }

    private async reconcileRecord(record: SubmittedTransactionRecord): Promise<void> {
        const ensuredRecord = await this.ensureSubmittedRecord(record);
        const tx = await this.circleClient.getTransaction(ensuredRecord.txId!);
        if (!this.circleClient.isSuccessfulTerminalState(tx.state) && !this.circleClient.isFailedTerminalState(tx.state)) {
            return;
        }

        const payment = this.rehydrateSubmittedPayment(ensuredRecord);
        this.clearSubmittedTransaction(ensuredRecord.chatId);

        if (ensuredRecord.context === "approval") {
            if (this.circleClient.isSuccessfulTerminalState(tx.state)) {
                await this.executeRouterPayment(ensuredRecord.chatId, ensuredRecord.walletId, payment);
                return;
            }

            this.bot.sendMessage(
                ensuredRecord.chatId,
                `❌ Approval failed on Circle.\n\nCircle TxID: \`${ensuredRecord.txId}\`\nReason: ${this.describeFailure(tx)}`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        if (this.circleClient.isSuccessfulTerminalState(tx.state)) {
            this.bot.sendMessage(
                ensuredRecord.chatId,
                `✅ **Payment confirmed**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${ensuredRecord.txId}\``,
                { parse_mode: "Markdown" }
            );
            this.finalizePayment(ensuredRecord.chatId, payment, ensuredRecord.txId!);
            payment.onConfirmed?.();
            this.postConfirmHandler?.(ensuredRecord.chatId, payment);
            return;
        }

        this.bot.sendMessage(
            ensuredRecord.chatId,
            `❌ **Payment failed**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${ensuredRecord.txId}\`\nReason: ${this.describeFailure(tx)}`,
            { parse_mode: "Markdown" }
        );
    }

    async reconcileSubmittedTransactions(): Promise<void> {
        const records = this.submittedTransactionStore?.list() || [];

        for (const record of records) {
            if (!this.beginProcessing(record.chatId)) {
                continue;
            }

            try {
                await this.reconcileRecord(record);
            } catch (error) {
                console.error(`[Payment] Failed to reconcile submitted transaction ${record.txId}:`, error);
            } finally {
                this.endProcessing(record.chatId);
            }
        }
    }

    async preparePayment(
        chatId: number,
        beneficiary: string,
        amountStr: string,
        memo: string | null = "ArcPay",
        options?: { onConfirmed?: () => void; source?: PendingPaymentSource }
    ) {
        if (!amountStr || isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
            this.bot.sendMessage(chatId, "Please enter a valid amount. Example: `send 5 usdc to jack`", { parse_mode: "Markdown" });
            return;
        }

        if (String(beneficiary).startsWith("0x") && !ethers.isAddress(beneficiary)) {
            this.bot.sendMessage(chatId, "That wallet address looks invalid. Please send a full valid 0x address.");
            return;
        }

        let resolvedBeneficiary = beneficiary;
        let vendorName: string | null = null;
        const inputName = beneficiary;

        const isWalletAddress = ethers.isAddress(beneficiary);

        if (!isWalletAddress) {
            const vendorAddress = this.vendorStore.getVendor(chatId, inputName);
            if (vendorAddress) {
                vendorName = inputName.toLowerCase();
                resolvedBeneficiary = vendorAddress;
            } else {
                this.bot.sendMessage(chatId, `⚠️ I couldn't find **${inputName}** in your address book.\n\n` +
                    `**Option 1:** Pay directly with an address:\n\`send ${amountStr} usdc to 0x...\`\n\n` +
                    `**Option 2:** Save the vendor first:\n\`save vendor ${inputName} 0x...\``,
                    { parse_mode: "Markdown" });
                return;
            }
        }

        const walletAddress = this.walletStore.getWalletAddress(chatId);
        if (!walletAddress) {
            this.bot.sendMessage(chatId, "You don't have a wallet yet. Send `create wallet` before making payments.", { parse_mode: "Markdown" });
            return;
        }

        const amount = ethers.parseUnits(amountStr, 6);

        this.pendingPay[chatId.toString()] = {
            beneficiary: resolvedBeneficiary,
            vendorName,
            amountStr,
            amount,
            memo,
            onConfirmed: options?.onConfirmed,
            source: options?.source
        };
        this.persistPendingPayment(chatId, this.pendingPay[chatId.toString()]);

        if (this.sessionStore) {
            this.sessionStore.setPendingPayment(chatId, vendorName || beneficiary, parseFloat(amountStr));
        }

        const displayRecipient = vendorName || inputName;
        const message = `Review payment\n\nAmount: **${amountStr} USDC**\nRecipient: **${displayRecipient}**\nDestination: \`${resolvedBeneficiary}\`${memo ? `\nMemo: ${memo}` : ""}\n\nWhat happens next:\n• I’ll check your balance\n• I’ll check whether approval is needed\n• I’ll submit the payment through Circle after you confirm`;

        const inlineKeyboard = [
            [
                { text: "Confirm", callback_data: `confirm_${chatId}` },
                { text: "Cancel", callback_data: `cancel_${chatId}` }
            ]
        ];

        this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    }

    cancelPendingPayment(chatId: number) {
        const chatIdStr = chatId.toString();
        if (this.pendingPay[chatIdStr] || this.hydratePendingPayment(chatId)) {
            this.clearPendingPayment(chatId);
            this.bot.sendMessage(chatId, "✅ Payment cancelled.");
        } else {
            this.bot.sendMessage(chatId, "❌ No pending payment to cancel.");
        }
    }

    updatePendingPayment(chatId: number, updates: { amount?: number, vendor?: string, memo?: string }) {
        const chatIdStr = chatId.toString();
        const payment = this.pendingPay[chatIdStr] || this.hydratePendingPayment(chatId);

        if (!payment) {
            this.bot.sendMessage(chatId, "❌ No pending payment found to update.");
            return;
        }

        let updatedMemo = payment.memo;
        if (updates.memo) {
            updatedMemo = updates.memo.toLowerCase() === "clear" ? null : updates.memo;
            payment.memo = updatedMemo;
        }

        if (updates.amount !== undefined) {
            payment.amountStr = updates.amount.toString();
            payment.amount = ethers.parseUnits(payment.amountStr, 6);
        }

        if (updates.vendor) {
            if (String(updates.vendor).startsWith("0x") && !ethers.isAddress(updates.vendor)) {
                this.bot.sendMessage(chatId, "That wallet address looks invalid. Please send a full valid 0x address.");
                return;
            }

            const isWalletAddress = ethers.isAddress(updates.vendor);
            if (isWalletAddress) {
                payment.beneficiary = updates.vendor;
                payment.vendorName = null;
            } else {
                const vendorAddress = this.vendorStore.getVendor(chatId, updates.vendor);
                if (vendorAddress) {
                    payment.vendorName = updates.vendor.toLowerCase();
                    payment.beneficiary = vendorAddress;
                } else {
                    this.bot.sendMessage(chatId, `⚠️ I couldn't find **${updates.vendor}** in your address book.`, { parse_mode: "Markdown" });
                    return;
                }
            }
        }

        if (this.sessionStore) {
            this.sessionStore.updatePendingPayment(chatId, { vendor: payment.vendorName || payment.beneficiary, amount: parseFloat(payment.amountStr) });
        }
        this.persistPendingPayment(chatId, payment);

        const displayRecipient = payment.vendorName || payment.beneficiary;
        const message = `Payment updated\n\nAmount: **${payment.amountStr} USDC**\nRecipient: **${displayRecipient}**\nDestination: \`${payment.beneficiary}\`${updatedMemo ? `\nMemo: ${updatedMemo}` : ""}\n\nWhat happens next:\n• I’ll check your balance\n• I’ll check whether approval is needed\n• I’ll submit the payment through Circle after you confirm`;

        const inlineKeyboard = [
            [
                { text: "Confirm", callback_data: `confirm_${chatId}` },
                { text: "Cancel", callback_data: `cancel_${chatId}` }
            ]
        ];

        this.bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    }

    async processCallback(query: TelegramBot.CallbackQuery) {
        const data = query.data;
        if (!data || !query.message || !query.from) return;

        const parts = data.split("_");
        const action = parts[0];
        if (!parts[1]) {
            this.bot.answerCallbackQuery(query.id, { text: "Invalid callback data." });
            return;
        }

        const chatId = parseInt(parts[1], 10);
        const senderId = query.from.id;
        if (!Number.isInteger(chatId) || chatId !== senderId) {
            this.bot.answerCallbackQuery(query.id, {
                text: "This action is not available for your account."
            });
            return;
        }
        const chatIdStr = chatId.toString();

        if (action === "cancel") {
            this.clearPendingPayment(chatId);
            this.bot.editMessageText("Payment cancelled.", {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
            return;
        }

        if (!this.beginProcessing(chatId)) {
            this.bot.answerCallbackQuery(query.id, { text: "This payment is already processing." });
            return;
        }

        try {
            const submitted = this.getSubmittedTransaction(chatId);
            if (submitted) {
                this.bot.answerCallbackQuery(query.id, {
                    text: submitted.context === "approval"
                        ? "Approval is already processing on Circle."
                        : "Payment is already processing on Circle."
                });
                return;
            }

            const payment = this.pendingPay[chatIdStr] || this.hydratePendingPayment(chatId);
            if (!payment) {
                this.bot.answerCallbackQuery(query.id, { text: "Payment session expired or not found." });
                return;
            }

            const walletId = this.walletStore.getWalletId(chatId);
            const walletAddress = this.walletStore.getWalletAddress(chatId);
            if (!walletId || !walletAddress) return;

            if (action === "confirm") {
                const networkError = await this.validateArcNetwork();
                if (networkError) {
                    this.bot.editMessageText(networkError, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        parse_mode: "Markdown"
                    });
                    return;
                }

                const balance = await this.usdc.balanceOf(walletAddress);
                const gasReserve = getArcGasReserveUsdc();
                const totalRequired = payment.amount + gasReserve;

                if (balance < totalRequired) {
                    this.bot.editMessageText(`❌ **Insufficient balance**\n\nPayment: ${payment.amountStr} USDC\nArc gas reserve: ${ethers.formatUnits(gasReserve, 6)} USDC\nTotal required: ${ethers.formatUnits(totalRequired, 6)} USDC\nAvailable: ${ethers.formatUnits(balance, 6)} USDC\n\nArc uses USDC for gas, so keep a small extra balance before confirming.`, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        parse_mode: "Markdown"
                    });
                    this.clearPendingPayment(chatId);
                    return;
                }

                const currentAllowance = await this.usdc.allowance(walletAddress, this.routerAddress);
                const needsApproval = currentAllowance < payment.amount;

                if (needsApproval) {
                    this.bot.editMessageText(`Approval required before payment\n\nAmount: ${payment.amountStr} USDC\nDestination: \`${payment.beneficiary}\`\n\nThis one-time approval lets the Arc router move USDC from your wallet for this payment flow.`, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "Approve via Circle", callback_data: `approve_${chatId}` },
                                    { text: "Cancel", callback_data: `cancel_${chatId}` }
                                ]
                            ]
                        }
                    });
                    return;
                }

                await this.executeRouterPayment(chatId, walletId, payment, query.message.message_id);
            }

            if (action === "approve") {
                this.bot.editMessageText("Submitting approval to Circle. This can take a few moments...", {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });

                const encodedApprove = this.usdc.encodeApprove(this.routerAddress, payment.amount);
                const record = this.createSubmissionAttempt(chatId, walletId, payment, "approval");
                const txId = await this.circleClient.createTransaction(walletId, this.usdc.getAddress(), encodedApprove, record.idempotencyKey);
                this.markSubmittedTransaction(record, txId);
                this.clearPendingPayment(chatId);
                const approvalState = await this.resolveSubmittedTransaction(chatId, payment, txId, "approval");

                if (approvalState === "confirmed") {
                    await this.executeRouterPayment(chatId, walletId, payment, query.message.message_id);
                    return;
                }
            }
        } catch (error: any) {
            let userMsg = "❌ Transaction failed.";
            const errMsg = error.message || "";

            if (errMsg.includes("transfer_failed") || errMsg.includes("insufficient funds")) {
                userMsg = "❌ USDC transfer failed due to balance or gas limit rules.";
            } else {
                userMsg = `❌ Circle transaction failed: ${errMsg.substring(0, 200)}`;
            }

            this.bot.sendMessage(chatId, userMsg);
            this.clearPendingPayment(chatId);
        } finally {
            this.endProcessing(chatId);
        }
    }

    private async executeRouterPayment(chatId: number, walletId: string, payment: PendingPayment, messageId?: number) {
        if (messageId) {
            this.bot.editMessageText("Processing payment securely on Circle...", {
                chat_id: chatId,
                message_id: messageId
            });
        }

        const encodedPay = this.router.encodePay(payment.beneficiary, payment.amount, payment.memo || "");
        const record = this.createSubmissionAttempt(chatId, walletId, payment, "payment");
        const txId = await this.circleClient.createTransaction(walletId, this.routerAddress, encodedPay, record.idempotencyKey);
        this.markSubmittedTransaction(record, txId);
        this.clearPendingPayment(chatId);
        this.bot.sendMessage(chatId, `⏳ **Payment submitted**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${txId}\`\n\nCircle is processing the transaction. I’ll update you when it reaches a final status.`, {
            parse_mode: "Markdown"
        });
        await this.resolveSubmittedTransaction(chatId, payment, txId, "payment");
    }
}
