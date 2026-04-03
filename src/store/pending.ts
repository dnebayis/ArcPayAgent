import { DB } from "./db";

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

export class PendingPaymentStore {
    constructor(private db: DB) {}

    async get(chatId: number): Promise<PendingPayment | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM pending_payments WHERE chat_id=$1", [chatId]
        );
        return row ? rowToPending(row) : null;
    }

    async set(chatId: number, payment: PendingPayment): Promise<void> {
        await this.db.run(
            `INSERT INTO pending_payments (chat_id,beneficiary,vendor_name,amount_str,amount,memo,token,created_at,source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (chat_id) DO UPDATE SET
               beneficiary=$2,vendor_name=$3,amount_str=$4,amount=$5,memo=$6,token=$7,created_at=$8,source=$9`,
            [chatId, payment.beneficiary, payment.vendorName, payment.amountStr, payment.amount,
             payment.memo, payment.token, payment.createdAt,
             payment.source ? JSON.stringify(payment.source) : null]
        );
    }

    async clear(chatId: number): Promise<void> {
        await this.db.run("DELETE FROM pending_payments WHERE chat_id=$1", [chatId]);
    }

    async listAll(): Promise<Array<{ chatId: number; payment: PendingPayment }>> {
        const rows = await this.db.query<any>("SELECT * FROM pending_payments");
        return rows.map(row => ({ chatId: Number(row.chat_id), payment: rowToPending(row) }));
    }
}

function rowToPending(row: any): PendingPayment {
    return {
        beneficiary: row.beneficiary,
        vendorName: row.vendor_name,
        amountStr: row.amount_str,
        amount: row.amount,
        memo: row.memo,
        token: row.token as "USDC" | "EURC",
        createdAt: Number(row.created_at),
        source: row.source ? JSON.parse(row.source) : undefined,
    };
}
