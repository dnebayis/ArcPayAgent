import { loadStore, saveStore } from "./persistence";
import { randomBytes } from "crypto";

export interface PriceAlert {
    id: string;
    chatId: number;
    symbol: string;
    targetPrice: number;
    direction: "above" | "below";
    createdAt: number;
    triggered: boolean;
}

type AlertData = Record<string, PriceAlert[]>; // key: chatId.toString()

const FILENAME = "price_alerts";

export class AlertStore {
    private data: AlertData = {};

    constructor() {
        this.data = loadStore<AlertData>(FILENAME) || {};
    }

    private persist(): void {
        saveStore(FILENAME, this.data);
    }

    createAlert(chatId: number, symbol: string, targetPrice: number, direction: "above" | "below"): PriceAlert {
        const key = chatId.toString();
        if (!this.data[key]) this.data[key] = [];

        // Dedup: return existing untriggered alert for same symbol+direction+price
        const existing = this.data[key].find(
            a => !a.triggered
                && a.symbol === symbol.toUpperCase()
                && a.direction === direction
                && a.targetPrice === targetPrice
        );
        if (existing) return existing;

        const alert: PriceAlert = {
            id: randomBytes(4).toString("hex"),
            chatId,
            symbol: symbol.toUpperCase(),
            targetPrice,
            direction,
            createdAt: Date.now(),
            triggered: false
        };

        this.data[key].push(alert);
        this.persist();
        return alert;
    }

    getAlerts(chatId: number): PriceAlert[] {
        return (this.data[chatId.toString()] || []).filter(a => !a.triggered);
    }

    getAllActive(): PriceAlert[] {
        return Object.values(this.data)
            .flat()
            .filter(a => !a.triggered);
    }

    markTriggered(alertId: string): void {
        for (const alerts of Object.values(this.data)) {
            const alert = alerts.find(a => a.id === alertId);
            if (alert) {
                alert.triggered = true;
                this.persist();
                return;
            }
        }
    }

    removeAlert(chatId: number, alertId: string): boolean {
        const key = chatId.toString();
        if (!this.data[key]) return false;
        const before = this.data[key].length;
        this.data[key] = this.data[key].filter(a => a.id !== alertId);
        if (this.data[key].length < before) {
            this.persist();
            return true;
        }
        return false;
    }

    removeAllAlerts(chatId: number): number {
        const key = chatId.toString();
        const active = (this.data[key] || []).filter(a => !a.triggered);
        this.data[key] = [];
        this.persist();
        return active.length;
    }
}
