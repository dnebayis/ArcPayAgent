import { nanoid } from "nanoid";
import { DB } from "./db";

export interface PaymentLog {
    id: string;
    vendor: string;
    address: string;
    amount: number;
    token: "USDC" | "EURC";
    timestamp: number;
    memo?: string;
    txHash?: string;
}

export class PaymentLogStore {
    constructor(private db: DB) {}

    async logPayment(chatId: number, entry: Omit<PaymentLog, "id"> & { id?: string }): Promise<void> {
        const id = entry.id ?? nanoid(10);
        await this.db.run(
            `INSERT INTO payments (id,chat_id,vendor,address,amount,token,timestamp,memo,tx_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
            [id, chatId, entry.vendor, entry.address, entry.amount, entry.token,
             entry.timestamp, entry.memo ?? null, entry.txHash ?? null]
        );
    }

    async getPayments(chatId: number): Promise<PaymentLog[]> {
        const rows = await this.db.query<any>(
            "SELECT * FROM payments WHERE chat_id=$1 ORDER BY timestamp DESC", [chatId]
        );
        return rows.map(rowToPayment);
    }

    async getPaymentsSince(chatId: number, since: number): Promise<PaymentLog[]> {
        const rows = await this.db.query<any>(
            "SELECT * FROM payments WHERE chat_id=$1 AND timestamp>=$2 ORDER BY timestamp DESC",
            [chatId, since]
        );
        return rows.map(rowToPayment);
    }

    async getRecentPayments(chatId: number, limit = 10): Promise<PaymentLog[]> {
        const rows = await this.db.query<any>(
            "SELECT * FROM payments WHERE chat_id=$1 ORDER BY timestamp DESC LIMIT $2",
            [chatId, limit]
        );
        return rows.map(rowToPayment);
    }
}

function rowToPayment(row: any): PaymentLog {
    return {
        id: row.id,
        vendor: row.vendor,
        address: row.address,
        amount: Number(row.amount),
        token: row.token as "USDC" | "EURC",
        timestamp: Number(row.timestamp),
        memo: row.memo ?? undefined,
        txHash: row.tx_hash ?? undefined,
    };
}
