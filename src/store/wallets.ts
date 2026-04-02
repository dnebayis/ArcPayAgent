import { Store } from "./base";

export interface WalletData {
    walletId: string;
    address: string;
    createdAt: number;
}

const NS = "wallets";

export class WalletStore {
    constructor(private store: Store) {}

    async hasWallet(chatId: number): Promise<boolean> {
        return !!(await this.store.get<WalletData>(NS, String(chatId)));
    }

    async getWallet(chatId: number): Promise<WalletData | null> {
        return this.store.get<WalletData>(NS, String(chatId));
    }

    async getWalletAddress(chatId: number): Promise<string | null> {
        const w = await this.getWallet(chatId);
        return w?.address ?? null;
    }

    async getWalletId(chatId: number): Promise<string | null> {
        const w = await this.getWallet(chatId);
        return w?.walletId ?? null;
    }

    async saveWallet(chatId: number, walletId: string, address: string): Promise<void> {
        await this.store.set(NS, String(chatId), { walletId, address, createdAt: Date.now() });
    }
}
