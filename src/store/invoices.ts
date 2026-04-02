import { Store } from "./base";

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

const NS = "invoices";

export class InvoiceStore {
    constructor(private store: Store) {}

    async getSession(chatId: number): Promise<InvoiceSession | null> {
        return this.store.get<InvoiceSession>(NS, String(chatId));
    }

    async saveSession(chatId: number, session: InvoiceSession): Promise<void> {
        await this.store.set(NS, String(chatId), session);
    }

    async clearSession(chatId: number): Promise<void> {
        await this.store.delete(NS, String(chatId));
    }

    async updateStatus(chatId: number, status: InvoiceSession["status"]): Promise<void> {
        const session = await this.getSession(chatId);
        if (session) {
            session.status = status;
            await this.store.set(NS, String(chatId), session);
        }
    }
}
