import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupHandlers } from "../../src/telegram/handlers";

describe("Telegram handlers callback flows", () => {
    let bot: any;
    let listeners: Record<string, (payload: any) => Promise<void>>;
    let paymentEngine: any;
    let paymentRequestEngine: any;
    let scheduleStore: any;

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
            {} as any,
            { getStatus: vi.fn(), removeKey: vi.fn(), setModel: vi.fn() } as any,
            { routeIntent: vi.fn() } as any,
            { parse: vi.fn() } as any,
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
            source: {
                type: "schedule",
                scheduleId: "sched-1",
                originChatId: 12345,
                originMessageId: 77
            }
        });
    });
});
