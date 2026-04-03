import { Store } from "./base";

export interface SubmittedTx {
    chatId: number;
    txId: string;
    idempotencyKey: string;
    status: "creating" | "submitted";
    context: "approval" | "payment";
    walletId: string;
    beneficiary: string;
    vendorName: string | null;
    amountStr: string;
    amount: string;
    memo: string | null;
    token: "USDC" | "EURC";
    source?: any;
    submittedAt: number;
}

const NS = "submitted";

export class SubmittedTxStore {
    /**
     * Namespace : submitted
     * Key pattern: {chatId}
     * Value type : SubmittedTx
     */
    constructor(private store: Store) {}

    async get(chatId: number): Promise<SubmittedTx | null> {
        return this.store.get<SubmittedTx>(NS, String(chatId));
    }

    async set(record: SubmittedTx): Promise<void> {
        await this.store.set(NS, String(record.chatId), record);
    }

    async clear(chatId: number): Promise<void> {
        await this.store.delete(NS, String(chatId));
    }

    async listAll(): Promise<SubmittedTx[]> {
        const all = await this.store.getAll<SubmittedTx>(NS);
        return Object.values(all);
    }
}
