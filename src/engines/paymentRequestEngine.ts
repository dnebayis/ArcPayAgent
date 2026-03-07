import TelegramBot from "node-telegram-bot-api";
import { PaymentRequestStore } from "../storage/paymentRequests";
import { WalletStore } from "../storage/walletStore";

export class PaymentRequestEngine {
    constructor(
        private bot: TelegramBot,
        private requestStore: PaymentRequestStore,
        private walletStore: WalletStore,
        private botUsername: string
    ) { }

    /**
     * Step 2 — Create a payment request and return the deep link
     */
    createRequest(chatId: number, amount: number, token: string = "USDC"): void {
        const walletAddress = this.walletStore.getWalletAddress(chatId);
        if (!walletAddress) {
            this.bot.sendMessage(chatId, "You don't have a wallet yet. Send 'create wallet' first.");
            return;
        }

        const requestId = this.requestStore.createRequest(chatId, walletAddress, amount, token);

        // Step 3 — Generate Telegram deep link (strip @ from username)
        const username = this.botUsername.replace(/^@/, "");
        const link = `https://t.me/${username}?start=req_${requestId}`;

        this.bot.sendMessage(
            chatId,
            `✅ Payment request created.\n\nAmount: **${amount} ${token}**\n\nShare this link:\n\`${link}\``,
            { parse_mode: "Markdown" }
        );
    }

    /**
     * Step 4-5 — Handle incoming /start req_<id> deep link
     */
    handleDeepLink(chatId: number, requestId: string): void {
        const request = this.requestStore.getRequest(requestId);

        if (!request) {
            this.bot.sendMessage(chatId, "❌ Payment request not found or has expired.");
            return;
        }

        // Step 8 — Duplicate payment protection
        if (request.paid) {
            this.bot.sendMessage(chatId, "This payment request has already been completed.");
            return;
        }

        // Step 5 — Show payment request details
        this.bot.sendMessage(
            chatId,
            `💳 Payment request detected.\n\nAmount: **${request.amount} ${request.token}**\nRecipient: \`${request.recipient}\``,
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Pay", callback_data: `reqpay_${chatId}_${requestId}` },
                            { text: "Cancel", callback_data: `reqcancel_${chatId}_${requestId}` }
                        ]
                    ]
                }
            }
        );
    }

    /**
     * Step 7 — Mark request as paid after successful payment
     */
    markPaid(requestId: string): void {
        this.requestStore.markPaid(requestId);
    }

    /**
     * Get request data for use in callback handlers
     */
    getRequest(requestId: string) {
        return this.requestStore.getRequest(requestId);
    }
}
