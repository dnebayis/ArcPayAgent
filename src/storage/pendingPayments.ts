import { loadStore, saveStore } from "./persistence";

const PENDING_PAYMENTS_FILE = "pending_payments.json";

export interface PendingPaymentSource {
    type: "direct" | "request" | "schedule";
    requestId?: string;
    scheduleId?: string;
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
        this.store[chatId.toString()] = payment;
        this.persist();
    }

    clearPendingPayment(chatId: number | string): void {
        const id = chatId.toString();
        if (!this.store[id]) return;
        delete this.store[id];
        this.persist();
    }
}
