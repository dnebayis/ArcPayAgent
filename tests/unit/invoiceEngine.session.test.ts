import { describe, expect, it, vi } from "vitest";
import { ConversationMemory } from "../../src/agent/conversationMemory";
import { InvoiceEngine, type ExtractedInvoice } from "../../src/engines/invoiceEngine";

function buildInvoice(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
    return {
        vendor: "Anthropic, PBC",
        amount: "10",
        currency: "USDC",
        detectedAmount: "10",
        detectedCurrency: "USD",
        settlementAmount: "10",
        settlementCurrency: "USDC",
        invoiceNumber: "INV-42",
        date: "January 22, 2026",
        ...overrides
    };
}

describe("InvoiceEngine session lifecycle", () => {
    it("stores a review-required active session without prepare buttons", async () => {
        const bot = { sendMessage: vi.fn() } as any;
        const conversationMemory = new ConversationMemory();
        const engine = new InvoiceEngine(
            bot,
            { saveInvoice: vi.fn() } as any,
            { resolveVendor: vi.fn().mockReturnValue({ name: "Anthropic, PBC", data: { address: "0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328" } }) } as any,
            conversationMemory
        );

        (engine as any).riskEngine = {
            analyzeInvoiceRisk: vi.fn().mockReturnValue({
                level: "REVIEW",
                riskScore: 0.42,
                flags: ["duplicate_invoice"]
            })
        };

        const session = await engine.processInvoice(1, buildInvoice(), {
            sourceMessageId: 99,
            sourceMimeType: "application/pdf"
        });

        expect(session?.status).toBe("review_required");
        expect(session?.risk?.requiresOverride).toBe(true);
        expect(engine.getActiveSession(1)?.invoice.invoiceNumber).toBe("INV-42");
        expect(conversationMemory.getContext(1).lastInvoice?.invoiceNumber).toBe("INV-42");
        expect(bot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("go ahead anyway"),
            expect.objectContaining({
                parse_mode: "Markdown"
            })
        );
        expect(bot.sendMessage.mock.calls[0][2]?.reply_markup).toBeUndefined();
    });

    it("opens a ready-to-prepare session with prepare buttons", async () => {
        const bot = { sendMessage: vi.fn() } as any;
        const engine = new InvoiceEngine(
            bot,
            { saveInvoice: vi.fn() } as any,
            { resolveVendor: vi.fn().mockReturnValue({ name: "Anthropic, PBC", data: { address: "0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328" } }) } as any
        );

        (engine as any).riskEngine = {
            analyzeInvoiceRisk: vi.fn().mockReturnValue({
                level: "SAFE",
                riskScore: 0.03,
                flags: []
            })
        };

        const session = await engine.processInvoice(1, buildInvoice());

        expect(session?.status).toBe("ready_to_prepare");
        expect(bot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("Risk check passed"),
            expect.objectContaining({
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "Prepare Payment", callback_data: "invpay_1" },
                        { text: "Cancel", callback_data: "invcancel_1" }
                    ]]
                }
            })
        );
    });

    it("replaces the active invoice session on a new upload", async () => {
        const bot = { sendMessage: vi.fn() } as any;
        const engine = new InvoiceEngine(
            bot,
            { saveInvoice: vi.fn() } as any,
            { resolveVendor: vi.fn().mockReturnValue({ name: "Anthropic, PBC", data: { address: "0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328" } }) } as any
        );

        (engine as any).riskEngine = {
            analyzeInvoiceRisk: vi.fn()
                .mockReturnValueOnce({
                    level: "SAFE",
                    riskScore: 0.02,
                    flags: []
                })
                .mockReturnValueOnce({
                    level: "SAFE",
                    riskScore: 0.01,
                    flags: []
                })
        };

        const first = await engine.processInvoice(1, buildInvoice({ invoiceNumber: "INV-42" }));
        const second = await engine.processInvoice(1, buildInvoice({ invoiceNumber: "INV-43" }));

        expect(first?.id).not.toBe(second?.id);
        expect(engine.getActiveSession(1)?.invoice.invoiceNumber).toBe("INV-43");
    });

    it("refreshes an active session after the vendor is saved later", async () => {
        const bot = { sendMessage: vi.fn() } as any;
        const resolveVendor = vi.fn().mockReturnValueOnce(null).mockReturnValue({
            name: "TURKCELL İLETİŞİM HİZMETLERİ A.Ş",
            data: { address: "0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328" }
        });
        const engine = new InvoiceEngine(
            bot,
            { saveInvoice: vi.fn() } as any,
            { resolveVendor } as any
        );

        (engine as any).riskEngine = {
            analyzeInvoiceRisk: vi.fn().mockReturnValue({
                level: "SAFE",
                riskScore: 0.03,
                flags: []
            })
        };

        await engine.processInvoice(1, buildInvoice({
            vendor: "TURKCELL İLETİŞİM HİZMETLERİ A.Ş",
            amount: "18.89",
            settlementAmount: "18.89",
            detectedAmount: "836.90",
            detectedCurrency: "TRY",
            settlementCurrency: "USDC"
        }));

        const refreshed = engine.getActiveSession(1);

        expect(refreshed?.status).toBe("ready_to_prepare");
        expect(refreshed?.resolution.canPreparePayment).toBe(true);
        expect(refreshed?.resolution.resolvedBeneficiary).toBe("0xd4f2ee18bf1e8f96aeaef111f109bc7f337e0328");
    });

    it("restores an awaiting-payment invoice session after interruption", async () => {
        const bot = { sendMessage: vi.fn() } as any;
        const engine = new InvoiceEngine(
            bot,
            { saveInvoice: vi.fn() } as any,
            { resolveVendor: vi.fn().mockReturnValue({ name: "Anthropic, PBC", data: { address: "0x1d0d4da384f58612970100f4f3f22d4134369ca7" } }) } as any
        );

        (engine as any).riskEngine = {
            analyzeInvoiceRisk: vi.fn().mockReturnValue({
                level: "REVIEW",
                riskScore: 0.4,
                flags: ["duplicate_invoice"]
            })
        };

        const session = await engine.processInvoice(1, buildInvoice());
        expect(session?.status).toBe("review_required");

        engine.markSessionAwaitingPaymentConfirmation(1, session?.id);
        expect(engine.getActiveSession(1)?.status).toBe("awaiting_payment_confirmation");

        const restored = engine.restoreSessionAfterPaymentInterruption(1, session?.id);
        expect(restored?.status).toBe("review_required");
    });
});
