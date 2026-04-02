import { Store } from "./base";

export interface PaymentSource {
    type: "user" | "invoice" | "request" | "schedule";
    requestId?: string;
    scheduleId?: string;
    invoiceSessionId?: string;
    originChatId?: number;
    originMessageId?: number;
}

export interface PendingPayment {
    beneficiary: string;
    vendorName: string | null;
    amountStr: string;
    amount: string; // bigint as string
    memo: string | null;
    token: "USDC" | "EURC";
    createdAt: number;
    source?: PaymentSource;
}

const NS = "pending_payments";

export class PendingPaymentStore {
    constructor(private store: Store) {}

    async get(chatId: number): Promise<PendingPayment | null> {
        return this.store.get<PendingPayment>(NS, String(chatId));
    }

    async set(chatId: number, payment: PendingPayment): Promise<void> {
        await this.store.set(NS, String(chatId), payment);
    }

    async clear(chatId: number): Promise<void> {
        await this.store.delete(NS, String(chatId));
    }

    async listAll(): Promise<Array<{ chatId: number; payment: PendingPayment }>> {
        const all = await this.store.getAll<PendingPayment>(NS);
        return Object.entries(all).map(([k, v]) => ({ chatId: parseInt(k, 10), payment: v }));
    }
}
