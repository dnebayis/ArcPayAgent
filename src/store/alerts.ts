import { nanoid } from "nanoid";
import { DB } from "./db";

export interface PriceAlert {
    id: string;
    symbol: string;
    targetPrice: number;
    direction: "above" | "below";
    active: boolean;
    triggered: boolean;
    createdAt: number;
    triggeredAt?: number;
}

export class AlertStore {
    constructor(private db: DB) {}

    async createAlert(
        chatId: number,
        opts: { symbol: string; targetPrice: number; direction: "above" | "below" }
    ): Promise<PriceAlert | null> {
        const sym = opts.symbol.toUpperCase();
        const dup = await this.db.queryOne<any>(
            `SELECT 1 FROM price_alerts WHERE chat_id=$1 AND symbol=$2 AND direction=$3
             AND target_price=$4 AND active=1 AND triggered=0`,
            [chatId, sym, opts.direction, opts.targetPrice]
        );
        if (dup) return null;

        const id = nanoid(10);
        const now = Date.now();
        await this.db.run(
            `INSERT INTO price_alerts (id,chat_id,symbol,target_price,direction,active,triggered,created_at)
             VALUES ($1,$2,$3,$4,$5,1,0,$6)`,
            [id, chatId, sym, opts.targetPrice, opts.direction, now]
        );
        return { id, symbol: sym, targetPrice: opts.targetPrice, direction: opts.direction, active: true, triggered: false, createdAt: now };
    }

    async getAlerts(chatId: number): Promise<PriceAlert[]> {
        const rows = await this.db.query<any>(
            "SELECT * FROM price_alerts WHERE chat_id=$1 AND active=1 AND triggered=0", [chatId]
        );
        return rows.map(rowToAlert);
    }

    async getAllActiveAlerts(): Promise<Array<{ chatId: number; alert: PriceAlert }>> {
        const rows = await this.db.query<any>(
            "SELECT * FROM price_alerts WHERE active=1 AND triggered=0"
        );
        return rows.map(row => ({ chatId: Number(row.chat_id), alert: rowToAlert(row) }));
    }

    async markTriggered(chatId: number, alertId: string): Promise<void> {
        await this.db.run(
            "UPDATE price_alerts SET triggered=1, triggered_at=$1 WHERE chat_id=$2 AND id=$3",
            [Date.now(), chatId, alertId]
        );
    }

    async removeAlert(chatId: number, alertId: string): Promise<boolean> {
        const row = await this.db.queryOne<any>(
            "SELECT 1 FROM price_alerts WHERE chat_id=$1 AND id=$2", [chatId, alertId]
        );
        if (!row) return false;
        await this.db.run("DELETE FROM price_alerts WHERE chat_id=$1 AND id=$2", [chatId, alertId]);
        return true;
    }

    async removeAllAlerts(chatId: number): Promise<number> {
        const rows = await this.db.query<any>(
            "SELECT count(*) as cnt FROM price_alerts WHERE chat_id=$1", [chatId]
        );
        const count = Number(rows[0]?.cnt ?? 0);
        await this.db.run("DELETE FROM price_alerts WHERE chat_id=$1", [chatId]);
        return count;
    }
}

function rowToAlert(row: any): PriceAlert {
    return {
        id: row.id,
        symbol: row.symbol,
        targetPrice: Number(row.target_price),
        direction: row.direction as "above" | "below",
        active: !!row.active,
        triggered: !!row.triggered,
        createdAt: Number(row.created_at),
        triggeredAt: row.triggered_at ? Number(row.triggered_at) : undefined,
    };
}
