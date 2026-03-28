import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupHandlers } from "../../src/telegram/handlers";

describe("Telegram handlers callback flows", () => {
    let bot: any;
    let listeners: Record<string, (payload: any) => Promise<void>>;
    let paymentEngine: any;
    let paymentRequestEngine: any;
    let scheduleStore: any;
    let orchestrator: any;

    beforeEach(() => {
        listeners = {};
        bot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
            setMyCommands: vi.fn().mockResolvedValue(undefined),
            on: vi.fn((event: string, handler: (payload: any) => Promise<void>) => {
                listeners[event] = handler;
            })
        };

        orchestrator = {
            handleMessage: vi.fn().mockResolvedValue(undefined),
            reset: vi.fn()
        };

        paymentEngine = {
            preparePayment: vi.fn(),
            processCallback: vi.fn()
        };

        paymentRequestEngine = {
            getRequest: vi.fn(),
            markPaid: vi.fn()
        };

        scheduleStore = {
            getScheduleById: vi.fn(),
            markExecuted: vi.fn(),
            cancelSchedule: vi.fn()
        };

        setupHandlers(
            bot,
            {} as any,
            { getStatus: vi.fn(), removeKey: vi.fn(), setModel: vi.fn() } as any,
            orchestrator,
            paymentEngine,
            undefined,
            paymentRequestEngine,
            undefined,
            scheduleStore,
            undefined
        );
    });

    it("should mark a payment request paid only after payment confirmation", async () => {
        paymentRequestEngine.getRequest.mockReturnValue({
            amount: 25,
            recipient: "0x0000000000000000000000000000000000000001",
            paid: false
        });

        await listeners.callback_query({
            id: "cb1",
            data: "reqpay_12345_req-1",
            from: { id: 12345 },
            message: { chat: { id: 12345 }, message_id: 99 }
        });

        expect(paymentRequestEngine.markPaid).not.toHaveBeenCalled();
        expect(paymentEngine.preparePayment).toHaveBeenCalledTimes(1);

        const prepareArgs = paymentEngine.preparePayment.mock.calls[0];
        expect(prepareArgs[0]).toBe(12345);
        expect(prepareArgs[1]).toBe("0x0000000000000000000000000000000000000001");
        expect(prepareArgs[2]).toBe("25");
        expect(prepareArgs[4]).toEqual({
            source: {
                type: "request",
                requestId: "req-1",
                originChatId: 12345,
                originMessageId: 99
            }
        });
    });

    it("should treat terse help punctuation as the help command", async () => {
        await listeners.message({
            chat: { id: 12345 },
            text: "help?"
        });

        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        expect(bot.sendMessage.mock.calls[0][0]).toBe(12345);
        expect(bot.sendMessage.mock.calls[0][1]).toContain("Arc Pay Agent — Guide");
    });

    it("should mark a schedule executed only after payment confirmation", async () => {
        scheduleStore.getScheduleById.mockReturnValue({
            id: "sched-1",
            vendor: "aws",
            amount: 10
        });

        await listeners.callback_query({
            id: "cb2",
            data: "sched_pay_12345_sched-1",
            from: { id: 12345 },
            message: { chat: { id: 12345 }, message_id: 77 }
        });

        expect(scheduleStore.markExecuted).not.toHaveBeenCalled();
        expect(paymentEngine.preparePayment).toHaveBeenCalledTimes(1);

        const prepareArgs = paymentEngine.preparePayment.mock.calls[0];
        expect(prepareArgs[0]).toBe(12345);
        expect(prepareArgs[1]).toBe("aws");
        expect(prepareArgs[2]).toBe("10");
        expect(prepareArgs[4]).toEqual({
            token: "USDC",
            source: {
                type: "schedule",
                scheduleId: "sched-1",
                originChatId: 12345,
                originMessageId: 77
            }
        });
    });

    it("should cancel a schedule via pick_cancel_sched callback", async () => {
        await listeners.callback_query({
            id: "cb-pick",
            data: "pick_cancel_sched_12345_sched-2",
            from: { id: 12345 },
            message: { chat: { id: 12345 }, message_id: 78 }
        });

        expect(bot.answerCallbackQuery).toHaveBeenCalledWith("cb-pick", { text: "Cancelling selected schedule..." });
        expect(scheduleStore.cancelSchedule).toHaveBeenCalledWith(12345, "sched-2");
        expect(bot.sendMessage).toHaveBeenCalledWith(12345, "❌ Scheduled payment sched-2 cancelled.");
    });

    it("should mark an invoice payment as invoice-sourced", async () => {
        const invoiceEngine = {
            getActiveSession: vi.fn().mockReturnValue({
                id: "inv-session-1",
                status: "ready_to_prepare",
                invoice: {
                    vendor: "Anthropic, PBC",
                    amount: "10",
                    invoiceNumber: "INV-42"
                },
                resolution: {
                    matchedVendorName: "Anthropic, PBC",
                    canPreparePayment: true
                },
                risk: {
                    level: "SAFE"
                }
            }),
            storeInvoice: vi.fn(),
            markSessionAwaitingPaymentConfirmation: vi.fn()
        };

        listeners = {};
        bot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
            setMyCommands: vi.fn().mockResolvedValue(undefined),
            on: vi.fn((event: string, handler: (payload: any) => Promise<void>) => {
                listeners[event] = handler;
            })
        };

        paymentEngine = {
            preparePayment: vi.fn(),
            processCallback: vi.fn()
        };

        setupHandlers(
            bot,
            {} as any,
            { getStatus: vi.fn(), removeKey: vi.fn(), setModel: vi.fn() } as any,
            orchestrator,
            paymentEngine,
            invoiceEngine as any,
            undefined,
            undefined,
            scheduleStore,
            undefined
        );

        await listeners.callback_query({
            id: "cb3",
            data: "invpay_12345",
            from: { id: 12345 },
            message: { chat: { id: 12345 }, message_id: 55 }
        });

        expect(paymentEngine.preparePayment).toHaveBeenCalledWith(
            12345,
            "Anthropic, PBC",
            "10",
            "Invoice INV-42",
            {
                source: {
                    type: "invoice",
                    invoiceSessionId: "inv-session-1",
                    invoiceNumber: "INV-42",
                    riskLevelAtPreparation: "SAFE",
                    requiredOverride: false,
                    originChatId: 12345,
                    originMessageId: 55
                }
            }
        );
    });
});

describe("Telegram handlers message flow", () => {
    let bot: any;
    let listeners: Record<string, (payload: any) => Promise<void>>;
    let orchestrator: any;
    let conversationMemory: any;
    let invoiceEngine: any;
    let paymentEngine: any;

    beforeEach(() => {
        listeners = {};
        bot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
            getFileLink: vi.fn().mockResolvedValue("https://example.com/file"),
            setMyCommands: vi.fn().mockResolvedValue(undefined),
            on: vi.fn((event: string, handler: (payload: any) => Promise<void>) => {
                listeners[event] = handler;
            })
        };

        orchestrator = {
            handleMessage: vi.fn().mockResolvedValue(undefined),
            reset: vi.fn()
        };

        conversationMemory = {
            clearContext: vi.fn()
        };

        invoiceEngine = {
            clearPendingInvoice: vi.fn(),
            sendInvoiceSummary: vi.fn(),
            analyzeInvoice: vi.fn().mockResolvedValue({
                vendor: "AWS",
                amount: "10",
                currency: "USDC",
                detectedAmount: "10",
                detectedCurrency: "USDC",
                settlementAmount: "10",
                settlementCurrency: "USDC",
                invoiceNumber: "INV-1"
            }),
            processInvoiceSilent: vi.fn().mockResolvedValue({
                session: {
                    id: "session-1",
                    invoice: { vendor: "AWS", amount: "10", currency: "USDC", detectedAmount: "10", detectedCurrency: "USDC", settlementAmount: "10", settlementCurrency: "USDC", invoiceNumber: "INV-1", date: null },
                    risk: null,
                    resolution: { displayVendor: "AWS", matchedVendorName: null, resolvedBeneficiary: null, canPreparePayment: false, requiresOverride: false }
                },
                error: null
            })
        };

        paymentEngine = {
            cancelPendingPayment: vi.fn(),
            resetPendingPayment: vi.fn().mockReturnValue(false)
        };

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
        }));

        setupHandlers(
            bot,
            {} as any,
            { getStatus: vi.fn(), removeKey: vi.fn(), setModel: vi.fn() } as any,
            orchestrator,
            paymentEngine,
            invoiceEngine,
            undefined,
            conversationMemory,
            undefined,
            undefined
        );
    });

    it("should ignore punctuation-only messages", async () => {
        await listeners.message({
            chat: { id: 1 },
            text: "."
        });

        expect(orchestrator.handleMessage).not.toHaveBeenCalled();
        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it("should handle /reset command by clearing conversation context", async () => {
        await listeners.message({
            chat: { id: 1 },
            text: "/reset"
        });

        // /reset is a built-in command — it clears context and does NOT forward to orchestrator
        expect(conversationMemory.clearContext).toHaveBeenCalledWith(1);
        expect(orchestrator.handleMessage).not.toHaveBeenCalled();
    });

    it("should route text messages to orchestrator", async () => {
        await listeners.message({
            chat: { id: 1 },
            text: "What can you do?"
        });

        expect(orchestrator.handleMessage).toHaveBeenCalledWith(1, "What can you do?");
    });

    it("should analyze a PDF invoice silently and pass caption to orchestrator", async () => {
        await listeners.message({
            chat: { id: 1 },
            document: {
                file_id: "file-1",
                mime_type: "application/pdf"
            },
            caption: "is this invoice safe?"
        });

        expect(bot.sendMessage).toHaveBeenCalledWith(1, "📄 Analyzing invoice...");
        expect(invoiceEngine.analyzeInvoice).toHaveBeenCalledTimes(1);
        expect(invoiceEngine.processInvoiceSilent).toHaveBeenCalledWith(1, expect.anything(), {
            sourceMessageId: undefined,
            sourceMimeType: "application/pdf"
        });
        // Caption is combined with invoice context and passed to orchestrator
        expect(orchestrator.handleMessage).toHaveBeenCalledTimes(1);
        expect(orchestrator.handleMessage.mock.calls[0][0]).toBe(1);
        expect(orchestrator.handleMessage.mock.calls[0][1]).toContain("is this invoice safe?");
    });

    it("should analyze a PDF invoice silently and show summary without caption", async () => {
        await listeners.message({
            chat: { id: 1 },
            document: {
                file_id: "file-1",
                mime_type: "application/pdf"
            }
        });

        expect(bot.sendMessage).toHaveBeenCalledWith(1, "📄 Analyzing invoice...");
        expect(invoiceEngine.analyzeInvoice).toHaveBeenCalledTimes(1);
        expect(invoiceEngine.processInvoiceSilent).toHaveBeenCalledTimes(1);
        expect(invoiceEngine.sendInvoiceSummary).toHaveBeenCalledTimes(1);
        // No caption → orchestrator is NOT called
        expect(orchestrator.handleMessage).not.toHaveBeenCalled();
    });

    it("should analyze a photo invoice silently and pass caption to orchestrator", async () => {
        await listeners.message({
            chat: { id: 1 },
            photo: [
                { file_id: "small" },
                { file_id: "large" }
            ],
            caption: "pay that invoice"
        });

        expect(bot.sendMessage).toHaveBeenCalledWith(1, "🖼️ Analyzing invoice image...");
        expect(invoiceEngine.analyzeInvoice).toHaveBeenCalledTimes(1);
        expect(invoiceEngine.processInvoiceSilent).toHaveBeenCalledWith(1, expect.anything(), {
            sourceMessageId: undefined,
            sourceMimeType: "image/png"
        });
        expect(orchestrator.handleMessage).toHaveBeenCalledTimes(1);
        expect(orchestrator.handleMessage.mock.calls[0][1]).toContain("pay that invoice");
    });
});
