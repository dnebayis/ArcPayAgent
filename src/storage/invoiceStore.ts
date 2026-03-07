import crypto from "crypto";
import { loadStore, saveStore } from "./persistence";

const INVOICE_FILE = "invoices.json";

export interface InvoiceRecord {
    vendor: string;
    amount: string;
    currency: string;
    invoiceNumber: string | null;
    date: string | null;
    paid: boolean;
    createdAt: number;
}

export interface UserInvoices {
    invoices: Record<string, InvoiceRecord>;
    duplicateKeys: Record<string, boolean>;
}

export class InvoiceStore {
    private store: Record<string, UserInvoices>;

    constructor() {
        this.store = loadStore<Record<string, UserInvoices>>(INVOICE_FILE);
    }

    private persist(): void {
        saveStore(INVOICE_FILE, this.store);
    }

    private ensureUser(chatId: string): void {
        if (!this.store[chatId]) {
            this.store[chatId] = { invoices: {}, duplicateKeys: {} };
        }
    }

    private buildDuplicateKey(vendor: string, invoiceNumber: string | null, amount: string, date: string | null): string {
        if (invoiceNumber) {
            return `${vendor.toLowerCase()}_${invoiceNumber.toLowerCase()}`;
        }
        const raw = `${vendor.toLowerCase()}_${amount}_${(date || "nodate").toLowerCase()}`;
        return crypto.createHash("sha256").update(raw).digest("hex").substring(0, 16);
    }

    isDuplicate(chatId: string | number, vendor: string, invoiceNumber: string | null, amount: string, date: string | null): boolean {
        const id = chatId.toString();
        this.ensureUser(id);
        const key = this.buildDuplicateKey(vendor, invoiceNumber, amount, date);
        return !!this.store[id].duplicateKeys[key];
    }

    saveInvoice(chatId: string | number, invoice: Omit<InvoiceRecord, "paid" | "createdAt">): string {
        const id = chatId.toString();
        this.ensureUser(id);

        const key = this.buildDuplicateKey(invoice.vendor, invoice.invoiceNumber, invoice.amount, invoice.date);
        const invoiceId = crypto.randomUUID();

        this.store[id].invoices[invoiceId] = {
            ...invoice,
            paid: false,
            createdAt: Date.now()
        };
        this.store[id].duplicateKeys[key] = true;

        this.persist();
        return invoiceId;
    }

    markPaid(chatId: string | number, invoiceId: string): void {
        const id = chatId.toString();
        if (this.store[id]?.invoices[invoiceId]) {
            this.store[id].invoices[invoiceId].paid = true;
            this.persist();
        }
    }

    getInvoices(chatId: string | number): Record<string, InvoiceRecord> {
        const id = chatId.toString();
        return this.store[id]?.invoices || {};
    }
}
