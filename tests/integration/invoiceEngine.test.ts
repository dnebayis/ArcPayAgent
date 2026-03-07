import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvoiceEngine } from "../../src/engines/invoiceEngine";
import { InvoiceStore } from "../../src/storage/invoiceStore";

describe("InvoiceEngine Integration", () => {
    let mockBot: any;
    let invoiceStore: InvoiceStore;
    let mockVendorStore: any;
    let engine: InvoiceEngine;

    beforeEach(() => {
        mockBot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
        };
        invoiceStore = new InvoiceStore();
        mockVendorStore = {
            getVendor: vi.fn(),
            getVendorData: vi.fn().mockReturnValue(null),
        };
        engine = new InvoiceEngine(mockBot, invoiceStore, mockVendorStore);
    });

    describe("Field Extraction", () => {
        it("should extract amount and currency", async () => {
            const result = await engine.extractFields("Total: 50.00 USDC");
            expect(result.amount).toBe("50.00");
            expect(result.currency).toBe("USDC");
        });

        it("should extract invoice number", async () => {
            const result = await engine.extractFields("Invoice #INV-2024-001\nTotal: $100.00 USD");
            expect(result.invoiceNumber).toBe("INV-2024-001");
        });

        it("should extract date", async () => {
            const result = await engine.extractFields("Date: 03/04/2026\nAmount: 25.50 USDC");
            expect(result.date).toBe("03/04/2026");
        });

        it("should extract vendor name", async () => {
            const result = await engine.extractFields("From: Acme Corporation\nTotal: 200 USDC");
            expect(result.vendor).toBe("Acme Corporation");
        });

        it("should handle amounts with commas", async () => {
            const result = await engine.extractFields("Total: 1,250.00 USD");
            expect(result.amount).toBe("1250.00");
        });
    });

    describe("Invoice Processing", () => {
        it("should suggest payment for valid invoices", async () => {
            mockVendorStore.getVendor.mockReturnValue("0x001");

            await engine.processInvoice(12345, {
                vendor: "AWS",
                amount: "50",
                currency: "USDC",
                invoiceNumber: "INV-001",
                date: "01/01/2024"
            });

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("Invoice detected"),
                expect.objectContaining({
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "Prepare Payment", callback_data: "invpay_12345" },
                                { text: "Cancel", callback_data: "invcancel_12345" }
                            ]
                        ]
                    }
                })
            );
        });

        it("should flag duplicate invoices via risk engine", async () => {
            invoiceStore.saveInvoice(12345, {
                vendor: "AWS",
                amount: "50",
                currency: "USDC",
                invoiceNumber: "INV-001",
                date: "01/01/2024"
            });

            await engine.processInvoice(12345, {
                vendor: "AWS",
                amount: "50",
                currency: "USDC",
                invoiceNumber: "INV-001",
                date: "01/01/2024"
            });

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("Duplicate invoice"),
                expect.any(Object)
            );
        });

        it("should reject invoices with missing data", async () => {
            await engine.processInvoice(12345, {
                vendor: null,
                amount: null,
                currency: null,
                invoiceNumber: null,
                date: null
            });

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("I couldn't extract payment details"),
                expect.any(Object)
            );
        });

        it("should resolve vendor address in suggestion", async () => {
            mockVendorStore.getVendor.mockReturnValue("0xResolvedAddr");

            await engine.processInvoice(12345, {
                vendor: "AWS",
                amount: "50",
                currency: "USDC",
                invoiceNumber: "INV-002",
                date: "01/01/2024"
            });

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("0xResolvedAddr"),
                expect.any(Object)
            );
        });

        it("should block high-risk invoices", async () => {
            invoiceStore.saveInvoice(12345, {
                vendor: "scam",
                amount: "1000",
                currency: "USD",
                invoiceNumber: "SCAM-001",
                date: "01/01/2024"
            });

            (engine as any)._lastRawText = "URGENT: immediate payment required! Wire today!";

            await engine.processInvoice(12345, {
                vendor: "scam",
                amount: "1000",
                currency: "USD",
                invoiceNumber: "SCAM-001",
                date: "01/01/2024"
            });

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("High Risk"),
                expect.any(Object)
            );
        });
    });
});
