import { DB } from "./db";

export interface WatchConfig {
    enabled: boolean;
    walletAddress: string;
    lastUsdcBalance: string;
    lastEurcBalance: string;
    enabledAt: number;
}

export class WatchStore {
    constructor(private db: DB) {}

    async enable(chatId: number, walletAddress: string): Promise<void> {
        await this.db.run(
            `INSERT INTO watch_config (chat_id,enabled,wallet_address,last_usdc_balance,last_eurc_balance,enabled_at)
             VALUES ($1,1,$2,'0','0',$3)
             ON CONFLICT (chat_id) DO UPDATE SET enabled=1, wallet_address=$2, enabled_at=$3`,
            [chatId, walletAddress, Date.now()]
        );
    }

    async disable(chatId: number): Promise<void> {
        await this.db.run("UPDATE watch_config SET enabled=0 WHERE chat_id=$1", [chatId]);
    }

    async isEnabled(chatId: number): Promise<boolean> {
        const row = await this.db.queryOne<any>(
            "SELECT enabled FROM watch_config WHERE chat_id=$1", [chatId]
        );
        return !!row?.enabled;
    }

    async getConfig(chatId: number): Promise<WatchConfig | null> {
        const row = await this.db.queryOne<any>("SELECT * FROM watch_config WHERE chat_id=$1", [chatId]);
        return row ? rowToConfig(row) : null;
    }

    async updateBalances(chatId: number, usdc: string, eurc: string): Promise<void> {
        await this.db.run(
            "UPDATE watch_config SET last_usdc_balance=$1, last_eurc_balance=$2 WHERE chat_id=$3",
            [usdc, eurc, chatId]
        );
    }

    async getAllEnabled(): Promise<Array<{ chatId: number; config: WatchConfig }>> {
        const rows = await this.db.query<any>("SELECT * FROM watch_config WHERE enabled=1");
        return rows.map(row => ({ chatId: Number(row.chat_id), config: rowToConfig(row) }));
    }
}

function rowToConfig(row: any): WatchConfig {
    return {
        enabled: !!row.enabled,
        walletAddress: row.wallet_address,
        lastUsdcBalance: row.last_usdc_balance,
        lastEurcBalance: row.last_eurc_balance,
        enabledAt: Number(row.enabled_at),
    };
}
