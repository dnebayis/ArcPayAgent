import { DB } from "./db";
import { PaymentSource } from "./pending";

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
    source?: PaymentSource;
    submittedAt: number;
}

export class SubmittedTxStore {
    constructor(private db: DB) {}

    async get(chatId: number): Promise<SubmittedTx | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM submitted_txs WHERE chat_id=$1", [chatId]
        );
        return row ? rowToSubmitted(row) : null;
    }

    async set(record: SubmittedTx): Promise<void> {
        await this.db.run(
            `INSERT INTO submitted_txs
               (chat_id,tx_id,idempotency_key,status,context,wallet_id,beneficiary,vendor_name,amount_str,amount,memo,token,source,submitted_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (chat_id) DO UPDATE SET
               tx_id=$2,idempotency_key=$3,status=$4,context=$5,wallet_id=$6,
               beneficiary=$7,vendor_name=$8,amount_str=$9,amount=$10,memo=$11,
               token=$12,source=$13,submitted_at=$14`,
            [record.chatId, record.txId, record.idempotencyKey, record.status, record.context,
             record.walletId, record.beneficiary, record.vendorName, record.amountStr, record.amount,
             record.memo, record.token,
             record.source ? JSON.stringify(record.source) : null, record.submittedAt]
        );
    }

    async clear(chatId: number): Promise<void> {
        await this.db.run("DELETE FROM submitted_txs WHERE chat_id=$1", [chatId]);
    }

    async listAll(): Promise<SubmittedTx[]> {
        const rows = await this.db.query<any>("SELECT * FROM submitted_txs");
        return rows.map(rowToSubmitted);
    }
}

function rowToSubmitted(row: any): SubmittedTx {
    let source: PaymentSource | undefined;
    if (row.source) {
        try { source = JSON.parse(row.source); } catch { /* corrupted — ignore */ }
    }
    return {
        chatId: Number(row.chat_id),
        txId: row.tx_id,
        idempotencyKey: row.idempotency_key,
        status: row.status as "creating" | "submitted",
        context: row.context as "approval" | "payment",
        walletId: row.wallet_id,
        beneficiary: row.beneficiary,
        vendorName: row.vendor_name,
        amountStr: row.amount_str,
        amount: row.amount,
        memo: row.memo,
        token: row.token as "USDC" | "EURC",
        source,
        submittedAt: Number(row.submitted_at),
    };
}
