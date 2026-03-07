import { loadStore, saveStore } from "./persistence";
import { CircleClient } from "../blockchain/circleClient";

const WALLET_FILE = "wallets.json";

export interface WalletMetadata {
    walletId: string;
    address: string;
    createdAt: number;
}

export class WalletStore {
    private store: Record<string, WalletMetadata>;

    constructor(private circleClient: CircleClient) {
        this.store = loadStore<Record<string, WalletMetadata>>(WALLET_FILE);
    }

    private persist(): void {
        saveStore(WALLET_FILE, this.store);
    }

    hasWallet(chatId: string | number): boolean {
        return !!this.store[chatId.toString()];
    }

    async createWallet(chatId: string | number): Promise<string> {
        const id = chatId.toString();
        if (this.hasWallet(id)) {
            throw new Error("Wallet already exists for this user");
        }

        const { walletId, address } = await this.circleClient.createWallet();

        this.store[id] = {
            walletId,
            address,
            createdAt: Date.now()
        };

        this.persist();
        return address;
    }

    getWalletAddress(chatId: string | number): string | null {
        const id = chatId.toString();
        const wallet = this.store[id];
        return wallet ? wallet.address : null;
    }

    getWalletId(chatId: string | number): string | null {
        const id = chatId.toString();
        const wallet = this.store[id];
        return wallet ? wallet.walletId : null;
    }
}
