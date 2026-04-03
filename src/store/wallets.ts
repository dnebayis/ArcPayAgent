import { DB } from "./db";

export interface WalletData {
    walletId: string;
    address: string;
    createdAt: number;
}

export class WalletStore {
    constructor(private db: DB) {}

    async hasWallet(chatId: number): Promise<boolean> {
        return !!(await this.db.queryOne("SELECT 1 FROM wallets WHERE chat_id=$1", [chatId]));
    }

    async getWallet(chatId: number): Promise<WalletData | null> {
        const row = await this.db.queryOne<any>("SELECT * FROM wallets WHERE chat_id=$1", [chatId]);
        return row ? { walletId: row.wallet_id, address: row.address, createdAt: Number(row.created_at) } : null;
    }

    async getWalletAddress(chatId: number): Promise<string | null> {
        return (await this.getWallet(chatId))?.address ?? null;
    }

    async getWalletId(chatId: number): Promise<string | null> {
        return (await this.getWallet(chatId))?.walletId ?? null;
    }

    async saveWallet(chatId: number, walletId: string, address: string): Promise<void> {
        await this.db.run(
            `INSERT INTO wallets (chat_id,wallet_id,address,created_at) VALUES ($1,$2,$3,$4)
             ON CONFLICT (chat_id) DO UPDATE SET wallet_id=$2, address=$3`,
            [chatId, walletId, address, Date.now()]
        );
    }
}
