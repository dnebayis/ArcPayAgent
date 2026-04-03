import { nanoid } from "nanoid";
import { DB } from "./db";

export interface PaymentRequest {
    id: string;
    chatId: number;
    recipientAddress: string;
    amount: number;
    token: "USDC" | "EURC";
    paid: boolean;
    createdAt: number;
}

export class PaymentRequestStore {
    constructor(private db: DB) {}

    async create(chatId: number, recipientAddress: string, amount: number, token: "USDC" | "EURC" = "USDC"): Promise<PaymentRequest> {
        const id = nanoid(12);
        const now = Date.now();
        await this.db.run(
            `INSERT INTO payment_requests (id,chat_id,recipient_address,amount,token,paid,created_at)
             VALUES ($1,$2,$3,$4,$5,0,$6)`,
            [id, chatId, recipientAddress, amount, token, now]
        );
        return { id, chatId, recipientAddress, amount, token, paid: false, createdAt: now };
    }

    async get(requestId: string): Promise<PaymentRequest | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM payment_requests WHERE id=$1", [requestId]
        );
        return row ? rowToRequest(row) : null;
    }

    async markPaid(requestId: string): Promise<void> {
        await this.db.run("UPDATE payment_requests SET paid=1 WHERE id=$1", [requestId]);
    }
}

function rowToRequest(row: any): PaymentRequest {
    return {
        id: row.id,
        chatId: Number(row.chat_id),
        recipientAddress: row.recipient_address,
        amount: Number(row.amount),
        token: row.token as "USDC" | "EURC",
        paid: !!row.paid,
        createdAt: Number(row.created_at),
    };
}
