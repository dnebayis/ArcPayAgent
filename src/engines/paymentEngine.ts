import { ethers } from "ethers";
import TelegramBot from "node-telegram-bot-api";
import { USDC } from "../blockchain/usdc";
import { ArcRouter } from "../blockchain/arcRouter";
import { WalletStore } from "../storage/walletStore";
import { VendorStore } from "../storage/vendorStore";
import { PaymentLogStore } from "../storage/paymentLogs";
import { CircleClient } from "../blockchain/circleClient";
import { SessionStore } from "../agent/sessionStore";
import { MemoryStore } from "../ai/memoryStore";

export interface PendingPayment {
    beneficiary: string;
    vendorName: string | null;
    amountStr: string;
    amount: bigint;
    memo: string | null;
}

export class PaymentEngine {
    private pendingPay: Record<string, PendingPayment> = {};

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
        private memoryStore?: MemoryStore
    ) { }

    async preparePayment(chatId: number, beneficiary: string, amountStr: string, memo: string | null = "ArcPay") {
        if (!amountStr || isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
            this.bot.sendMessage(chatId, "Please specify a valid amount. Example: `send 5 usdc jack`", { parse_mode: "Markdown" });
            return;
        }

        let resolvedBeneficiary = beneficiary;
        let vendorName: string | null = null;
        const inputName = beneficiary;

        // Accept strict EVM addresses OR dummy mock addresses starting with 0x for video demonstration
        const isWalletAddress = ethers.isAddress(beneficiary) || String(beneficiary).startsWith('0x');

        if (!isWalletAddress) {
            const vendorAddress = this.vendorStore.getVendor(chatId, inputName);
            if (vendorAddress) {
                vendorName = inputName.toLowerCase();
                resolvedBeneficiary = vendorAddress;
            } else {
                this.bot.sendMessage(chatId, `⚠️ The recipient "**${inputName}**" is not in your Address Book.\n\n` +
                    `**Option 1:** Pay directly without saving:\n\`send ${amountStr} USDC to 0x...\`\n\n` +
                    `**Option 2:** Save them for future invoices:\n\`save vendor ${inputName} 0x...\``,
                    { parse_mode: "Markdown" });
                return;
            }
        }

        const walletAddress = this.walletStore.getWalletAddress(chatId);
        if (!walletAddress) {
            this.bot.sendMessage(chatId, "You don't have a wallet yet. Send 'create wallet' to generate one before making payments.");
            return;
        }

        const amount = ethers.parseUnits(amountStr, 6);

        this.pendingPay[chatId.toString()] = { beneficiary: resolvedBeneficiary, vendorName, amountStr, amount, memo };

        if (this.sessionStore) {
            this.sessionStore.setPendingPayment(chatId, vendorName || beneficiary, parseFloat(amountStr));
        }

        const message = `Prepare payment\n\n${amountStr} USDC → \`${resolvedBeneficiary}\``;

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
        if (this.pendingPay[chatIdStr]) {
            delete this.pendingPay[chatIdStr];
            if (this.sessionStore) this.sessionStore.clearPendingState(chatId);
            this.bot.sendMessage(chatId, "✅ Payment cancelled.");
        } else {
            this.bot.sendMessage(chatId, "❌ No pending payment to cancel.");
        }
    }

    updatePendingPayment(chatId: number, updates: { amount?: number, vendor?: string, memo?: string }) {
        const chatIdStr = chatId.toString();
        const payment = this.pendingPay[chatIdStr];

        if (!payment) {
            this.bot.sendMessage(chatId, "❌ No active pending payment found to update.");
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
            const isWalletAddress = ethers.isAddress(updates.vendor) || String(updates.vendor).startsWith('0x');
            if (isWalletAddress) {
                payment.beneficiary = updates.vendor;
                payment.vendorName = null;
            } else {
                const vendorAddress = this.vendorStore.getVendor(chatId, updates.vendor);
                if (vendorAddress) {
                    payment.vendorName = updates.vendor.toLowerCase();
                    payment.beneficiary = vendorAddress;
                } else {
                    this.bot.sendMessage(chatId, `⚠️ Vendor "**${updates.vendor}**" not found in Address Book. Update failed.`, { parse_mode: "Markdown" });
                    return;
                }
            }
        }

        if (this.sessionStore) {
            this.sessionStore.updatePendingPayment(chatId, { vendor: payment.vendorName || payment.beneficiary, amount: parseFloat(payment.amountStr) });
        }

        const message = `Updated payment\n\n${payment.amountStr} USDC → \`${payment.vendorName ? payment.vendorName : payment.beneficiary}\`${updatedMemo ? `\nMemo: ${updatedMemo}` : ""}`;

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
            delete this.pendingPay[chatIdStr];
            if (this.sessionStore) this.sessionStore.clearPendingState(chatId);
            this.bot.editMessageText("Payment cancelled.", {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
            return;
        }

        const payment = this.pendingPay[chatIdStr];
        if (!payment) {
            this.bot.answerCallbackQuery(query.id, { text: "Payment session expired or not found." });
            return;
        }

        const walletId = this.walletStore.getWalletId(chatId);
        const walletAddress = this.walletStore.getWalletAddress(chatId);
        if (!walletId || !walletAddress) return;

        try {
            if (action === "confirm") {
                const balance = await this.usdc.balanceOf(walletAddress);
                if (balance < payment.amount) {
                    this.bot.editMessageText(`❌ Insufficient USDC balance. Requires ${payment.amountStr} USDC.`, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id
                    });
                    delete this.pendingPay[chatIdStr];
                    if (this.sessionStore) this.sessionStore.clearPendingState(chatId);
                    return;
                }

                const currentAllowance = await this.usdc.allowance(walletAddress, this.routerAddress);
                const needsApproval = currentAllowance < payment.amount;

                if (needsApproval) {
                    this.bot.editMessageText("Approval required to spend USDC.", {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
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
                this.bot.editMessageText("Approving router via Circle (this might take a few moments)...", {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });

                const encodedApprove = this.usdc.encodeApprove(this.routerAddress, payment.amount);
                const txId = await this.circleClient.createTransaction(walletId, this.usdc.getAddress(), encodedApprove);

                // For simplicity, we assume we let Circle process it. 
                // A production system would poll Circle's transaction status here.
                // We'll simulate a slight wait to let Circle propagate before executing the next payload.
                await new Promise(r => setTimeout(r, 6000));

                await this.executeRouterPayment(chatId, walletId, payment, query.message.message_id);
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
            delete this.pendingPay[chatIdStr];
            if (this.sessionStore) this.sessionStore.clearPendingState(chatId);
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
        const txId = await this.circleClient.createTransaction(walletId, this.routerAddress, encodedPay);

        this.bot.sendMessage(chatId, `✅ **Payment sent via Circle!**\n\nAmount: ${payment.amountStr} USDC\nRecipient: \`${payment.beneficiary}\`\nCircle TxID: \`${txId}\``, {
            parse_mode: "Markdown"
        });

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
                txHash: txId // we log the Circle transaction ID as txHash
            });
        }

        delete this.pendingPay[chatId.toString()];
        if (this.sessionStore) this.sessionStore.clearPendingState(chatId);
    }
}
