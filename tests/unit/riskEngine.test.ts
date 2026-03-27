import { describe, it, expect, vi } from "vitest";
import { RiskEngine } from "../../src/engines/riskEngine";
import { InvoiceStore } from "../../src/storage/invoiceStore";
import { VendorStore } from "../../src/storage/vendorStore";
import { ExtractedInvoice } from "../../src/engines/invoiceEngine";

function createRiskEngine() {
    const invoiceStore = new InvoiceStore();
    const vendorStore = new VendorStore();
    const engine = new RiskEngine(invoiceStore, vendorStore);
    return { invoiceStore, vendorStore, engine };
}

describe("RiskEngine", () => {
    describe("Duplicate Invoice Detection", () => {
        it("should flag duplicate invoices", () => {
            const { invoiceStore, engine } = createRiskEngine();

            // Save an existing invoice
            invoiceStore.saveInvoice(1, {
                vendor: "AWS",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-001",
                date: "2026-01-15"
            });

            const invoice: ExtractedInvoice = {
                vendor: "AWS",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-001",
                date: "2026-01-15"
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).toContain("duplicate_invoice");
            expect(result.riskScore).toBeGreaterThan(0.3);
        });

        it("should not flag new invoices", () => {
            const { engine } = createRiskEngine();

            const invoice: ExtractedInvoice = {
                vendor: "AWS",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-NEW",
                date: "2026-01-15"
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).not.toContain("duplicate_invoice");
        });
    });

    describe("Unusual Amount Detection", () => {
        it("should flag unusually large amounts", () => {
            const { vendorStore, engine } = createRiskEngine();

            // Build vendor history with average of 30 USDC
            vendorStore.saveVendor(1, "aws", "0x001");
            vendorStore.recordPayment(1, "aws", 30);
            vendorStore.recordPayment(1, "aws", 30);
            vendorStore.recordPayment(1, "aws", 30);

            const invoice: ExtractedInvoice = {
                vendor: "aws",
                amount: "300", // 10x average
                currency: "USD",
                invoiceNumber: "INV-002",
                date: null
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).toContain("unusual_amount");
        });

        it("should not flag normal amounts", () => {
            const { vendorStore, engine } = createRiskEngine();

            vendorStore.saveVendor(1, "aws", "0x001");
            vendorStore.recordPayment(1, "aws", 30);
            vendorStore.recordPayment(1, "aws", 30);

            const invoice: ExtractedInvoice = {
                vendor: "aws",
                amount: "35",
                currency: "USD",
                invoiceNumber: "INV-003",
                date: null
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).not.toContain("unusual_amount");
        });
    });

    describe("Vendor Mismatch Detection", () => {
        it("should flag unknown vendors", () => {
            const { engine } = createRiskEngine();

            const invoice: ExtractedInvoice = {
                vendor: "SuspiciousCorp",
                amount: "100",
                currency: "USD",
                invoiceNumber: "INV-004",
                date: null
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).toContain("vendor_mismatch");
        });

        it("should not flag known vendors", () => {
            const { vendorStore, engine } = createRiskEngine();
            vendorStore.saveVendor(1, "aws", "0x001");

            const invoice: ExtractedInvoice = {
                vendor: "aws",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-005",
                date: null
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).not.toContain("vendor_mismatch");
        });
    });

    describe("Missing Fields Detection", () => {
        it("should flag invoices with missing fields", () => {
            const { engine } = createRiskEngine();

            const invoice: ExtractedInvoice = {
                vendor: null,
                amount: "50",
                currency: null,
                invoiceNumber: null,
                date: null
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).toContain("missing_fields");
        });

        it("should not flag complete invoices", () => {
            const { vendorStore, engine } = createRiskEngine();
            vendorStore.saveVendor(1, "aws", "0x001");

            const invoice: ExtractedInvoice = {
                vendor: "aws",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-006",
                date: "2026-01-15"
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.flags).not.toContain("missing_fields");
        });
    });

    describe("Suspicious Language Detection", () => {
        it("should flag suspicious language", () => {
            const { vendorStore, engine } = createRiskEngine();
            vendorStore.saveVendor(1, "vendor", "0x001");

            const invoice: ExtractedInvoice = {
                vendor: "vendor",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-007",
                date: "2026-01-15"
            };

            const result = engine.analyzeInvoiceRisk(1, invoice, "URGENT: Payment required immediately! Wire today or your account will be suspended.");
            expect(result.flags).toContain("suspicious_language");
            expect(result.riskScore).toBeGreaterThan(0);
        });
    });

    describe("Risk Levels", () => {
        it("should classify safe invoices (score < 0.3)", () => {
            const { vendorStore, engine } = createRiskEngine();
            vendorStore.saveVendor(1, "aws", "0x001");

            const invoice: ExtractedInvoice = {
                vendor: "aws",
                amount: "50",
                currency: "USD",
                invoiceNumber: "INV-010",
                date: "2026-01-15"
            };

            const result = engine.analyzeInvoiceRisk(1, invoice);
            expect(result.level).toBe("SAFE");
        });

        it("should classify high-risk invoices (duplicate + suspicious)", () => {
            const { invoiceStore, engine } = createRiskEngine();

            invoiceStore.saveInvoice(1, {
                vendor: "scammer",
                amount: "1000",
                currency: "USD",
                invoiceNumber: "INV-SCAM",
                date: "2026-01-15"
            });

            const invoice: ExtractedInvoice = {
                vendor: "scammer",
                amount: "1000",
                currency: "USD",
                invoiceNumber: "INV-SCAM",
                date: "2026-01-15"
            };

            const result = engine.analyzeInvoiceRisk(1, invoice, "URGENT immediate payment required! Wire today!");
            expect(result.level).toBe("HIGH_RISK");
            expect(result.riskScore).toBeGreaterThanOrEqual(0.6);
        });
    });

    describe("Risk Message Formatting", () => {
        it("should format risk messages with flags", () => {
            const msg = RiskEngine.formatRiskMessage({
                riskScore: 0.5,
                flags: ["duplicate_invoice", "unusual_amount"],
                level: "REVIEW"
            });

            expect(msg).toContain("Review Recommended");
            expect(msg).toContain("Duplicate invoice");
            expect(msg).toContain("unusually high");
            expect(msg).toContain("50%");
        });

        it("should return empty string for no flags", () => {
            const msg = RiskEngine.formatRiskMessage({
                riskScore: 0,
                flags: [],
                level: "SAFE"
            });

            expect(msg).toBe("");
        });

        it("should explain flags in natural language", () => {
            const explanations = RiskEngine.explainFlags({
                riskScore: 0.5,
                flags: ["duplicate_invoice", "vendor_mismatch"],
                level: "REVIEW"
            });

            expect(explanations[0]).toContain("previously seen invoice");
            expect(explanations[1]).toContain("not saved in your address book");
        });

        it("should build a conversational review summary", () => {
            const msg = RiskEngine.formatConversationalSummary("Anthropic, PBC", {
                riskScore: 0.5,
                flags: ["duplicate_invoice", "vendor_mismatch"],
                level: "REVIEW"
            }, {
                canPreparePayment: false,
                settlementAmount: "10.00",
                settlementCurrency: "USDC"
            });

            expect(msg).toContain("needs review");
            expect(msg).toContain("previously seen invoice");
            expect(msg).toContain("Save the vendor first");
        });

        it("should build a short recommendation for review cases", () => {
            const msg = RiskEngine.formatRecommendation({
                riskScore: 0.5,
                flags: ["duplicate_invoice", "vendor_mismatch"],
                level: "REVIEW"
            }, {
                canPreparePayment: false
            });

            expect(msg).toContain("save the vendor first");
        });

        it("should build a conversational safe summary", () => {
            const msg = RiskEngine.formatConversationalSummary("Anthropic, PBC", {
                riskScore: 0,
                flags: [],
                level: "SAFE"
            }, {
                canPreparePayment: true,
                settlementAmount: "10.00",
                settlementCurrency: "USDC"
            });

            expect(msg).toContain("looks safe right now");
            expect(msg).toContain("10.00 USDC");
        });
    });
});
