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

/** Compound row key: "{chatId}:{alertId}" */
const rowKey = (chatId: number, alertId: string) => `${chatId}:${alertId}`;

export class AlertStore {
    /**
     * Namespace : alerts
     * Key pattern: {chatId}:{alertId}
     * Value type : PriceAlert
     */
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
        await this.store.set(NS, rowKey(chatId, alert.id), alert);
        return alert;
    }

    async getAlerts(chatId: number): Promise<PriceAlert[]> {
        const all = await this.getAll(chatId);
        return all.filter(a => a.active && !a.triggered);
    }

    async getAllActiveAlerts(): Promise<Array<{ chatId: number; alert: PriceAlert }>> {
        const allNs = await this.store.getAll<PriceAlert>(NS);
        const result: Array<{ chatId: number; alert: PriceAlert }> = [];
        for (const [key, alert] of Object.entries(allNs)) {
            if (alert.active && !alert.triggered) {
                const chatId = parseInt(key.split(":")[0], 10);
                result.push({ chatId, alert });
            }
        }
        return result;
    }

    async markTriggered(chatId: number, alertId: string): Promise<void> {
        const a = await this.store.get<PriceAlert>(NS, rowKey(chatId, alertId));
        if (a) {
            a.triggered = true;
            a.triggeredAt = Date.now();
            await this.store.set(NS, rowKey(chatId, alertId), a);
        }
    }

    async removeAlert(chatId: number, alertId: string): Promise<boolean> {
        const existing = await this.store.get<PriceAlert>(NS, rowKey(chatId, alertId));
        if (!existing) return false;
        await this.store.delete(NS, rowKey(chatId, alertId));
        return true;
    }

    async removeAllAlerts(chatId: number): Promise<number> {
        const all = await this.getAll(chatId);
        const count = all.length;
        for (const a of all) {
            await this.store.delete(NS, rowKey(chatId, a.id));
        }
        return count;
    }

    private async getAll(chatId: number): Promise<PriceAlert[]> {
        const prefix = `${chatId}:`;
        const raw = await this.store.getByPrefix<PriceAlert>(NS, prefix);
        return Object.values(raw);
    }
}
