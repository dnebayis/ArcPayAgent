import { nanoid } from "nanoid";
import { Store } from "./base";

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

const NS = "alerts";

export class AlertStore {
    constructor(private store: Store) {}

    async createAlert(
        chatId: number, opts: { symbol: string; targetPrice: number; direction: "above" | "below" }
    ): Promise<PriceAlert | null> {
        const { symbol, targetPrice, direction } = opts;
        const all = await this.getAll(chatId);

        // Dedup: same symbol + direction + price = already exists
        const dup = all.find(a =>
            a.active && !a.triggered &&
            a.symbol === symbol.toUpperCase() &&
            a.direction === direction &&
            a.targetPrice === targetPrice
        );
        if (dup) return null;

        const alert: PriceAlert = {
            id: nanoid(10),
            symbol: symbol.toUpperCase(),
            targetPrice,
            direction,
            active: true,
            triggered: false,
            createdAt: Date.now(),
        };
        all.push(alert);
        await this.store.set(NS, String(chatId), all);
        return alert;
    }

    async getAlerts(chatId: number): Promise<PriceAlert[]> {
        const all = await this.getAll(chatId);
        return all.filter(a => a.active && !a.triggered);
    }

    async getAllActiveAlerts(): Promise<Array<{ chatId: number; alert: PriceAlert }>> {
        const allNs = await this.store.getAll<PriceAlert[]>(NS);
        const result: Array<{ chatId: number; alert: PriceAlert }> = [];
        for (const [chatIdStr, alerts] of Object.entries(allNs)) {
            for (const a of alerts) {
                if (a.active && !a.triggered) {
                    result.push({ chatId: parseInt(chatIdStr, 10), alert: a });
                }
            }
        }
        return result;
    }

    async markTriggered(chatId: number, alertId: string): Promise<void> {
        const all = await this.getAll(chatId);
        const a = all.find(x => x.id === alertId);
        if (a) { a.triggered = true; a.triggeredAt = Date.now(); await this.store.set(NS, String(chatId), all); }
    }

    async removeAlert(chatId: number, alertId: string): Promise<boolean> {
        const all = await this.getAll(chatId);
        const idx = all.findIndex(x => x.id === alertId);
        if (idx < 0) return false;
        all.splice(idx, 1);
        await this.store.set(NS, String(chatId), all);
        return true;
    }

    async removeAllAlerts(chatId: number): Promise<number> {
        const all = await this.getAll(chatId);
        const count = all.length;
        await this.store.set(NS, String(chatId), []);
        return count;
    }

    private async getAll(chatId: number): Promise<PriceAlert[]> {
        return (await this.store.get<PriceAlert[]>(NS, String(chatId))) ?? [];
    }
}
