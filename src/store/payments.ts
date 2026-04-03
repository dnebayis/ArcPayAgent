import { nanoid } from "nanoid";
import { Store } from "./base";

export interface PaymentLog {
    id: string;
    vendor: string;
    address: string;
    amount: number;
    token: "USDC" | "EURC";
    timestamp: number;
    memo?: string;
    txHash?: string;
}

const NS = "payments";

/** Compound row key: "{chatId}:{id}" */
const rowKey = (chatId: number, id: string) => `${chatId}:${id}`;

export class PaymentLogStore {
    /**
     * Namespace : payments
     * Key pattern: {chatId}:{id}
     * Value type : PaymentLog
     */
    constructor(private store: Store) {}

    async logPayment(chatId: number, entry: Omit<PaymentLog, "id"> & { id?: string }): Promise<void> {
        const id = entry.id ?? nanoid(10);
        const log: PaymentLog = { id, ...entry };
        await this.store.set(NS, rowKey(chatId, id), log);
    }

    async getPayments(chatId: number): Promise<PaymentLog[]> {
        return this.getAll(chatId);
    }

    async getPaymentsSince(chatId: number, since: number): Promise<PaymentLog[]> {
        const logs = await this.getAll(chatId);
        return logs.filter(l => l.timestamp >= since);
    }

    async getRecentPayments(chatId: number, limit = 10): Promise<PaymentLog[]> {
        const logs = await this.getAll(chatId);
        return logs.slice(-limit).reverse();
    }

    private async getAll(chatId: number): Promise<PaymentLog[]> {
        const prefix = `${chatId}:`;
        const raw = await this.store.getByPrefix<PaymentLog>(NS, prefix);
        return Object.values(raw).sort((a, b) => a.timestamp - b.timestamp);
    }
}
