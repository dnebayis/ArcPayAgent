import { Store } from "./base";

export interface PaymentLog {
    vendor: string;
    address: string;
    amount: number;
    token: "USDC" | "EURC";
    timestamp: number;
    memo?: string;
    txHash?: string;
}

const NS = "payment_logs";

export class PaymentLogStore {
    constructor(private store: Store) {}

    async logPayment(chatId: number, entry: PaymentLog): Promise<void> {
        const logs = await this.getAll(chatId);
        logs.push(entry);
        await this.store.set(NS, String(chatId), logs);
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
        return (await this.store.get<PaymentLog[]>(NS, String(chatId))) ?? [];
    }
}
