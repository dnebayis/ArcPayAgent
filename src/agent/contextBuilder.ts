import { WalletStore } from "../storage/walletStore";
import { VendorStore } from "../storage/vendorStore";
import { SessionStore, SessionState } from "./sessionStore";

export interface BuildContextResult {
    systemContext: string;
    recentMessages: { role: string; content: string }[];
    pendingAction?: string;
    lastVendor?: string;
    lastAmount?: number;
    pendingPayment?: { vendor: string | null; amount: number };
}

/**
 * Builds context about the current user for the AI layer.
 * This provides relevant state without exposing private keys.
 */
export class ContextBuilder {
    constructor(
        private walletStore: WalletStore,
        private vendorStore: VendorStore,
        private sessionStore: SessionStore
    ) { }

    buildContext(chatId: number, newMessage?: string): BuildContextResult {
        const hasWallet = this.walletStore.hasWallet(chatId);
        const address = hasWallet ? this.walletStore.getWalletAddress(chatId) : null;

        let context = `User ID: ${chatId}\n`;
        context += `Wallet: ${hasWallet ? "Created" : "Not created"}\n`;
        if (address) {
            context += `Address: ${address}\n`;
        }

        const session = this.sessionStore.getSession(chatId);

        if (newMessage) {
            this.sessionStore.addMessage(chatId, 'user', newMessage);
        }

        return {
            systemContext: context,
            recentMessages: session.recentMessages,
            pendingAction: session.pendingAction,
            lastVendor: session.lastVendor,
            lastAmount: session.lastAmount,
            pendingPayment: session.pendingPayment
        };
    }
}
