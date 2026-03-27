import { loadStore, saveStore } from "./persistence";

const PAYMENTS_LOG_FILE = "payment_logs.json";

export interface PaymentLogEntry {
    vendor: string | null;
    address: string;
    amount: number;
    timestamp: number;
    memo: string;
    txHash: string;
    token?: "USDC" | "EURC";
}

export interface UserPaymentLogs {
    payments: PaymentLogEntry[];
}

export class PaymentLogStore {
    private store: Record<string, UserPaymentLogs>;

    constructor() {
        this.store = loadStore<Record<string, UserPaymentLogs>>(PAYMENTS_LOG_FILE);
    }

    private persist(): void {
        saveStore(PAYMENTS_LOG_FILE, this.store);
    }

    logPayment(chatId: number, entry: PaymentLogEntry): void {
        const id = chatId.toString();
        if (!this.store[id]) {
            this.store[id] = { payments: [] };
        }
        this.store[id].payments.push(entry);
        this.persist();
    }

    getPayments(chatId: number): PaymentLogEntry[] {
        const id = chatId.toString();
        return this.store[id]?.payments || [];
    }

    /**
     * Get payments filtered by time range
     */
    getPaymentsSince(chatId: number, sinceTimestamp: number): PaymentLogEntry[] {
        return this.getPayments(chatId).filter(p => p.timestamp >= sinceTimestamp);
    }

    /**
     * Get the last N payments
     */
    getRecentPayments(chatId: number, limit: number = 10): PaymentLogEntry[] {
        const payments = this.getPayments(chatId);
        return payments.slice(-limit);
    }
}
