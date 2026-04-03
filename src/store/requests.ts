import { nanoid } from "nanoid";
import { Store } from "./base";

export interface PaymentRequest {
    id: string;
    chatId: number;
    recipientAddress: string;
    amount: number;
    token: "USDC" | "EURC";
    paid: boolean;
    createdAt: number;
}

const NS = "requests";

export class PaymentRequestStore {
    /**
     * Namespace : requests
     * Key pattern: {requestId}
     * Value type : PaymentRequest
     */
    constructor(private store: Store) {}

    async create(chatId: number, recipientAddress: string, amount: number, token: "USDC" | "EURC" = "USDC"): Promise<PaymentRequest> {
        const req: PaymentRequest = {
            id: nanoid(12),
            chatId,
            recipientAddress,
            amount,
            token,
            paid: false,
            createdAt: Date.now(),
        };
        await this.store.set(NS, req.id, req);
        return req;
    }

    async get(requestId: string): Promise<PaymentRequest | null> {
        return this.store.get<PaymentRequest>(NS, requestId);
    }

    async markPaid(requestId: string): Promise<void> {
        const req = await this.get(requestId);
        if (req) { req.paid = true; await this.store.set(NS, requestId, req); }
    }
}
