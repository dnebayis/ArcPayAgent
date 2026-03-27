import { loadStore, saveStore } from "./persistence";

const PENDING_PAYMENTS_FILE = "pending_payments.json";

export interface PendingPaymentSource {
    type: "direct" | "request" | "schedule" | "invoice";
    requestId?: string;
    scheduleId?: string;
    invoiceNumber?: string | null;
    invoiceSessionId?: string;
    riskLevelAtPreparation?: string | null;
    requiredOverride?: boolean;
    originChatId?: number;
    originMessageId?: number;
}

export interface PersistedPendingPayment {
    beneficiary: string;
    vendorName: string | null;
    amountStr: string;
    amount: string;
    memo: string | null;
    source?: PendingPaymentSource;
    createdAt?: number;
    token?: "USDC" | "EURC";
}

export class PendingPaymentStore {
    private store: Record<string, PersistedPendingPayment>;

    constructor() {
        this.store = loadStore<Record<string, PersistedPendingPayment>>(PENDING_PAYMENTS_FILE);
    }

    private persist(): void {
        saveStore(PENDING_PAYMENTS_FILE, this.store);
    }

    getPendingPayment(chatId: number | string): PersistedPendingPayment | null {
        return this.store[chatId.toString()] || null;
    }

    setPendingPayment(chatId: number | string, payment: PersistedPendingPayment): void {
        this.store[chatId.toString()] = {
            ...payment,
            createdAt: payment.createdAt ?? Date.now()
        };
        this.persist();
    }

    listAll(): { chatId: number; payment: PersistedPendingPayment }[] {
        return Object.entries(this.store).map(([chatId, payment]) => ({
            chatId: parseInt(chatId, 10),
            payment
        }));
    }

    clearPendingPayment(chatId: number | string): void {
        const id = chatId.toString();
        if (!this.store[id]) return;
        delete this.store[id];
        this.persist();
    }
}
