import { describe, it, expect, vi } from "vitest";
import { LLMKeyStore } from "../../src/storage/llmKeyStore";
import { InvoiceStore } from "../../src/storage/invoiceStore";

describe("LLMKeyStore", () => {
    it("should store, retrieve, and remove API keys securely", () => {
        const store = new LLMKeyStore("test-llm-secret");

        expect(store.hasKey(1)).toBe(false);
        expect(store.getStatus(1)).toBe("No LLM key configured.");

        store.setKey(1, "OpenAI", "sk-test123abc");

        expect(store.hasKey(1)).toBe(true);
        expect(store.getStatus(1)).toContain("openai");

        const auth = store.getKey(1);
        expect(auth).not.toBeNull();
        expect(auth?.provider).toBe("openai");
        expect(auth?.key).toBe("sk-test123abc");

        store.removeKey(1);
        expect(store.hasKey(1)).toBe(false);
    });

    it("should isolate keys per user", () => {
        const store = new LLMKeyStore("test-secret");

        store.setKey(1, "openai", "key-1");
        store.setKey(2, "openai", "key-2");

        expect(store.getKey(1)?.key).toBe("key-1");
        expect(store.getKey(2)?.key).toBe("key-2");
    });
});

describe("InvoiceStore", () => {
    it("should save and retrieve invoices", () => {
        const store = new InvoiceStore();

        const id = store.saveInvoice(1, {
            vendor: "AWS",
            amount: "50",
            currency: "USDC",
            invoiceNumber: "INV-001",
            date: "01/01/2024"
        });

        const invoices = store.getInvoices(1);
        expect(invoices[id]).toBeDefined();
        expect(invoices[id].vendor).toBe("AWS");
        expect(invoices[id].paid).toBe(false);
    });

    it("should detect duplicates by vendor + invoiceNumber", () => {
        const store = new InvoiceStore();

        expect(store.isDuplicate(1, "AWS", "INV-001", "50", null)).toBe(false);

        store.saveInvoice(1, {
            vendor: "AWS",
            amount: "50",
            currency: "USDC",
            invoiceNumber: "INV-001",
            date: null
        });

        expect(store.isDuplicate(1, "AWS", "INV-001", "50", null)).toBe(true);
    });

    it("should detect duplicates using hash fallback when no invoiceNumber", () => {
        const store = new InvoiceStore();

        store.saveInvoice(1, {
            vendor: "Vercel",
            amount: "99",
            currency: "USD",
            invoiceNumber: null,
            date: "02/15/2024"
        });

        expect(store.isDuplicate(1, "Vercel", null, "99", "02/15/2024")).toBe(true);
        expect(store.isDuplicate(1, "Vercel", null, "100", "02/15/2024")).toBe(false);
    });

    it("should mark invoices as paid", () => {
        const store = new InvoiceStore();

        const id = store.saveInvoice(1, {
            vendor: "AWS",
            amount: "50",
            currency: "USDC",
            invoiceNumber: "INV-002",
            date: null
        });

        expect(store.getInvoices(1)[id].paid).toBe(false);
        store.markPaid(1, id);
        expect(store.getInvoices(1)[id].paid).toBe(true);
    });
});
