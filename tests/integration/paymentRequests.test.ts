import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentRequestStore } from "../../src/storage/paymentRequests";
import { PaymentRequestEngine } from "../../src/engines/paymentRequestEngine";

describe("Payment Requests Integration", () => {
    let mockBot: any;
    let requestStore: PaymentRequestStore;
    let mockWalletStore: any;
    let engine: PaymentRequestEngine;

    beforeEach(() => {
        mockBot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
        };
        requestStore = new PaymentRequestStore();
        mockWalletStore = {
            getWalletAddress: vi.fn().mockReturnValue("0x0000000000000000000000000000000000000001"),
        };
        engine = new PaymentRequestEngine(mockBot, requestStore, mockWalletStore, "ArcPayTestBot");
    });

    describe("Request Creation", () => {
        it("should create a payment request and return a deep link", () => {
            engine.createRequest(12345, 20);

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("Payment request created"),
                expect.any(Object)
            );

            const sentText = mockBot.sendMessage.mock.calls[0][1];
            expect(sentText).toContain("20 USDC");
            expect(sentText).toContain("https://t.me/ArcPayTestBot?start=req_");
        });

        it("should store the request with correct data", () => {
            engine.createRequest(12345, 50);

            const sentText = mockBot.sendMessage.mock.calls[0][1];
            const requestId = sentText.match(/req_([a-zA-Z0-9_-]+)/)![1];

            const request = requestStore.getRequest(requestId);
            expect(request).not.toBeNull();
            expect(request!.amount).toBe(50);
            expect(request!.token).toBe("USDC");
            expect(request!.recipient).toBe("0x0000000000000000000000000000000000000001");
            expect(request!.createdBy).toBe(12345);
            expect(request!.paid).toBe(false);
        });

        it("should reject request creation without a wallet", () => {
            mockWalletStore.getWalletAddress.mockReturnValue(null);
            engine.createRequest(12345, 20);

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                12345,
                expect.stringContaining("don't have a wallet")
            );
        });
    });

    describe("Deep Link Handling", () => {
        it("should display payment request when deep link is opened", () => {
            engine.createRequest(11111, 50);

            const sentText = mockBot.sendMessage.mock.calls[0][1];
            const requestId = sentText.match(/req_([a-zA-Z0-9_-]+)/)![1];

            engine.handleDeepLink(22222, requestId);

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                22222,
                expect.stringContaining("Payment request detected"),
                expect.objectContaining({
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "Pay", callback_data: expect.stringContaining(`reqpay_22222_${requestId}`) },
                                { text: "Cancel", callback_data: expect.stringContaining(`reqcancel_22222_${requestId}`) }
                            ]
                        ]
                    }
                })
            );
        });

        it("should show amount and recipient in request display", () => {
            engine.createRequest(11111, 75);
            const sentText = mockBot.sendMessage.mock.calls[0][1];
            const requestId = sentText.match(/req_([a-zA-Z0-9_-]+)/)![1];

            engine.handleDeepLink(22222, requestId);

            const displayText = mockBot.sendMessage.mock.calls[1][1];
            expect(displayText).toContain("75 USDC");
            expect(displayText).toContain("0x0000000000000000000000000000000000000001");
        });

        it("should reject invalid request IDs", () => {
            engine.handleDeepLink(22222, "nonexistent_id");

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                22222,
                expect.stringContaining("Payment request not found")
            );
        });
    });

    describe("Duplicate Payment Protection", () => {
        it("should reject payment on already-paid requests", () => {
            engine.createRequest(11111, 30);
            const sentText = mockBot.sendMessage.mock.calls[0][1];
            const requestId = sentText.match(/req_([a-zA-Z0-9_-]+)/)![1];

            engine.markPaid(requestId);
            engine.handleDeepLink(22222, requestId);

            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                22222,
                expect.stringContaining("already been completed")
            );
        });
    });

    describe("PaymentRequestStore", () => {
        it("should store and retrieve requests", () => {
            const id = requestStore.createRequest(12345, "0xRecipient", 100);
            const request = requestStore.getRequest(id);

            expect(request).not.toBeNull();
            expect(request!.amount).toBe(100);
            expect(request!.token).toBe("USDC");
            expect(request!.recipient).toBe("0xRecipient");
            expect(request!.createdBy).toBe(12345);
            expect(request!.paid).toBe(false);
        });

        it("should mark requests as paid", () => {
            const id = requestStore.createRequest(12345, "0xRecipient", 50);
            expect(requestStore.isPaid(id)).toBe(false);
            requestStore.markPaid(id);
            expect(requestStore.isPaid(id)).toBe(true);
        });

        it("should return null for non-existent requests", () => {
            expect(requestStore.getRequest("fake_id")).toBeNull();
        });

        it("should generate unique IDs for each request", () => {
            const id1 = requestStore.createRequest(1, "0xA", 10);
            const id2 = requestStore.createRequest(1, "0xA", 10);
            expect(id1).not.toBe(id2);
        });
    });
});
