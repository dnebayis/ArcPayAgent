import { loadStore, saveStore } from "./persistence";
import { PendingPaymentSource } from "./pendingPayments";

const SUBMITTED_TRANSACTIONS_FILE = "submitted_transactions.json";

export type SubmittedTransactionContext = "approval" | "payment";
export type SubmittedTransactionStatus = "creating" | "submitted";

export interface SubmittedTransactionRecord {
    chatId: number;
    txId: string | null;
    idempotencyKey: string;
    status: SubmittedTransactionStatus;
    context: SubmittedTransactionContext;
    walletId: string;
    beneficiary: string;
    vendorName: string | null;
    amountStr: string;
    amount: string;
    memo: string | null;
    source?: PendingPaymentSource;
    submittedAt: number;
}

export class SubmittedTransactionStore {
    private store: Record<string, SubmittedTransactionRecord>;

    constructor() {
        this.store = loadStore<Record<string, SubmittedTransactionRecord>>(SUBMITTED_TRANSACTIONS_FILE);
    }

    private persist(): void {
        saveStore(SUBMITTED_TRANSACTIONS_FILE, this.store);
    }

    get(chatId: number | string): SubmittedTransactionRecord | null {
        return this.store[chatId.toString()] || null;
    }

    list(): SubmittedTransactionRecord[] {
        return Object.values(this.store);
    }

    set(record: SubmittedTransactionRecord): void {
        this.store[record.chatId.toString()] = record;
        this.persist();
    }

    clear(chatId: number | string): void {
        const id = chatId.toString();
        if (!this.store[id]) return;
        delete this.store[id];
        this.persist();
    }
}
