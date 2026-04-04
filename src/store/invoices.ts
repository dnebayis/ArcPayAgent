import { DB } from "./db";

export interface InvoiceSession {
    id: string;
    status: "uploaded" | "analyzed" | "review_required" | "ready_to_prepare" |
            "awaiting_override" | "awaiting_payment" | "paid" | "cancelled" | "closed";
    invoice: {
        vendor: string;
        amount: string;
        currency: string;
        detectedAmount?: string;
        detectedCurrency?: string;
        settlementAmount?: string;
        settlementCurrency?: string;
        invoiceNumber?: string;
        date?: string;
    };
    risk?: {
        level: "SAFE" | "REVIEW" | "HIGH_RISK";
        score: number;
        flags: string[];
        explanations: string[];
        canPreparePayment: boolean;
        requiresOverride: boolean;
        blocked: boolean;
    };
    resolution?: {
        displayVendor: string;
        matchedVendorName?: string;
        resolvedBeneficiary?: string;
        canPreparePayment: boolean;
    };
    sourceMessageId?: number;
    openedAt: number;
    expiresAt: number;
}

export class InvoiceStore {
    constructor(private db: DB) {}

    async getSession(chatId: number): Promise<InvoiceSession | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM invoice_sessions WHERE chat_id=$1", [chatId]
        );
        return row ? rowToSession(row) : null;
    }

    async saveSession(chatId: number, session: InvoiceSession): Promise<void> {
        await this.db.run(
            `INSERT INTO invoice_sessions
               (chat_id,session_id,status,invoice_data,risk,resolution,source_message_id,opened_at,expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (chat_id) DO UPDATE SET
               session_id=$2,status=$3,invoice_data=$4,risk=$5,resolution=$6,
               source_message_id=$7,opened_at=$8,expires_at=$9`,
            [chatId, session.id, session.status,
             JSON.stringify(session.invoice),
             session.risk ? JSON.stringify(session.risk) : null,
             session.resolution ? JSON.stringify(session.resolution) : null,
             session.sourceMessageId ?? null, session.openedAt, session.expiresAt]
        );
    }

    async clearSession(chatId: number): Promise<void> {
        await this.db.run("DELETE FROM invoice_sessions WHERE chat_id=$1", [chatId]);
    }

    async updateStatus(chatId: number, status: InvoiceSession["status"]): Promise<void> {
        await this.db.run(
            "UPDATE invoice_sessions SET status=$1 WHERE chat_id=$2", [status, chatId]
        );
    }
}

function safeJsonParse(str: string | null | undefined): any {
    if (!str) return undefined;
    try { return JSON.parse(str); } catch { return undefined; }
}

function rowToSession(row: any): InvoiceSession {
    return {
        id: row.session_id,
        status: row.status,
        invoice: safeJsonParse(row.invoice_data) ?? { vendor: "", amount: "0", currency: "USD" },
        risk: safeJsonParse(row.risk),
        resolution: safeJsonParse(row.resolution),
        sourceMessageId: row.source_message_id ? Number(row.source_message_id) : undefined,
        openedAt: Number(row.opened_at),
        expiresAt: Number(row.expires_at),
    };
}
