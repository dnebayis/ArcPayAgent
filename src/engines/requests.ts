import { logger } from "../utils/logger";
import type { PaymentRequestStore } from "../store/requests";
import type { WalletStore } from "../store/wallets";

export interface RequestEngineDeps {
    requests: PaymentRequestStore;
    wallets: WalletStore;
    send: (chatId: number, text: string) => Promise<void>;
    sendCard: (chatId: number, text: string, keyboard: any[][]) => Promise<void>;
    botUsername?: string;
}

export class RequestEngine {
    readonly deps: RequestEngineDeps;

    constructor(deps: RequestEngineDeps) {
        this.deps = deps;
    }

    async createRequest(chatId: number, amount: number, token: "USDC" | "EURC" = "USDC"): Promise<void> {
        const address = await this.deps.wallets.getWalletAddress(chatId);
        if (!address) {
            await this.deps.send(chatId, "You need a wallet first. Say \"create wallet\" to get started.");
            return;
        }

        const req = await this.deps.requests.create(chatId, address, amount, token);

        const botName = this.deps.botUsername || "ArcPayBot";
        const deepLink = `https://t.me/${botName}?start=pay_${req.id}`;

        const text = `Payment Request Created\n\nAmount: ${amount.toFixed(2)} ${token}\nRequest ID: ${req.id}\n\nShare this link to receive payment:\n${deepLink}`;

        await this.deps.send(chatId, text);
        logger.info(chatId, "[RequestEngine] Payment request created", { id: req.id, amount, token });
    }

    /**
     * Handle incoming /start pay_<requestId> deep link.
     * Returns payment details for the payer to confirm.
     */
    async handleDeepLink(payerChatId: number, requestId: string): Promise<void> {
        const req = await this.deps.requests.get(requestId);
        if (!req) {
            await this.deps.send(payerChatId, "This payment request was not found or has expired.");
            return;
        }

        if (req.paid) {
            await this.deps.send(payerChatId, "This payment request has already been paid.");
            return;
        }

        if (req.chatId === payerChatId) {
            await this.deps.send(payerChatId, "You can't pay your own payment request.");
            return;
        }

        const text = `Payment Request\n\nAmount: ${req.amount.toFixed(2)} ${req.token}\nTo: ${req.recipientAddress.slice(0, 6)}...${req.recipientAddress.slice(-4)}\nRequest ID: ${req.id}`;

        const keyboard = [
            [
                { text: "Pay Now", callback_data: `request_pay_${req.id}` },
                { text: "Decline", callback_data: `request_decline_${req.id}` },
            ],
        ];

        await this.deps.sendCard(payerChatId, text, keyboard);
    }

    async markPaid(requestId: string): Promise<void> {
        await this.deps.requests.markPaid(requestId);
    }
}
