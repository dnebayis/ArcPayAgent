import { nanoid } from "nanoid";
import { loadStore, saveStore } from "./persistence";

const REQUESTS_FILE = "payment_requests.json";

export interface PaymentRequest {
    amount: number;
    token: string;
    recipient: string;
    createdBy: number;
    createdAt: number;
    paid: boolean;
}

export class PaymentRequestStore {
    private store: Record<string, PaymentRequest>;

    constructor() {
        this.store = loadStore<Record<string, PaymentRequest>>(REQUESTS_FILE);
    }

    private persist(): void {
        saveStore(REQUESTS_FILE, this.store);
    }

    createRequest(chatId: number, recipientAddress: string, amount: number, token: string = "USDC"): string {
        const requestId = nanoid(12);

        this.store[requestId] = {
            amount,
            token,
            recipient: recipientAddress,
            createdBy: chatId,
            createdAt: Date.now(),
            paid: false
        };

        this.persist();
        return requestId;
    }

    getRequest(requestId: string): PaymentRequest | null {
        return this.store[requestId] || null;
    }

    markPaid(requestId: string): void {
        if (this.store[requestId]) {
            this.store[requestId].paid = true;
            this.persist();
        }
    }

    isPaid(requestId: string): boolean {
        return !!this.store[requestId]?.paid;
    }

    cancelRequest(requestId: string): boolean {
        if (!this.store[requestId] || this.store[requestId].paid) return false;
        delete this.store[requestId];
        this.persist();
        return true;
    }
}
