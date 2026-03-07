import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentEngine } from "../../src/engines/paymentEngine";
import { ethers } from "ethers";

describe("PaymentEngine Integration", () => {
    let mockBot: any;
    let mockUsdc: any;
    let mockRouter: any;
    let mockWalletStore: any;
    let mockVendorStore: any;
    let mockProvider: any;
    let mockPaymentLogStore: any;
    let mockCircleClient: any;

    beforeEach(() => {
        mockBot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
        };

        mockUsdc = {
            allowance: vi.fn(),
            approve: vi.fn(),
            balanceOf: vi.fn().mockResolvedValue(ethers.parseUnits("1000", 6)),
            encodeApprove: vi.fn().mockReturnValue("0xencodedApprove"),
            getAddress: vi.fn().mockReturnValue("0xUSDC"),
        };

        mockRouter = {
            pay: vi.fn(),
            encodePay: vi.fn().mockReturnValue("0xencodedPay"),
        };

        mockWalletStore = {
            getWalletId: vi.fn().mockReturnValue("circle-wallet-123"),
            getWalletAddress: vi.fn().mockReturnValue("0x1234567890123456789012345678901234567890")
        };

        mockVendorStore = {
            getVendor: vi.fn(),
            recordPayment: vi.fn()
        } as any;

        mockProvider = {};
        mockPaymentLogStore = {
            logPayment: vi.fn()
        };

        mockCircleClient = {
            createTransaction: vi.fn().mockResolvedValue("circle-tx-999"),
            waitForTerminalTransaction: vi.fn().mockResolvedValue({ id: "circle-tx-999", state: "COMPLETE", txHash: null, errorReason: null, errorDetails: null }),
            isSuccessfulTerminalState: vi.fn().mockImplementation((state: string) => ["COMPLETE"].includes(state)),
            isFailedTerminalState: vi.fn().mockImplementation((state: string) => ["FAILED", "DENIED", "CANCELLED"].includes(state))
        };
    });

    it("should prepare payment and show Confirm/Cancel buttons", async () => {
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            12345,
            expect.stringContaining("Prepare payment"),
            expect.objectContaining({
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Confirm", callback_data: "confirm_12345" },
                            { text: "Cancel", callback_data: "cancel_12345" }
                        ]
                    ]
                }
            })
        );
    });

    it("should resolve vendor name before payment", async () => {
        mockVendorStore.getVendor.mockReturnValue("0x0000000000000000000000000000000000000099");
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        await engine.preparePayment(12345, "jack", "50");

        expect(mockVendorStore.getVendor).toHaveBeenCalledWith(12345, "jack");
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            12345,
            expect.stringContaining("0x0000000000000000000000000000000000000099"),
            expect.any(Object)
        );
    });

    it("should reject unknown vendor names", async () => {
        mockVendorStore.getVendor.mockReturnValue(null);
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        await engine.preparePayment(12345, "nobody", "50");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            12345,
            expect.stringContaining("address book"),
            expect.any(Object)
        );
    });

    it("should require wallet before payment", async () => {
        mockWalletStore.getWalletAddress.mockReturnValue(null);
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "50");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            12345,
            expect.stringContaining("don't have a wallet yet"),
            expect.objectContaining({ parse_mode: "Markdown" })
        );
    });

    it("should check balance and reject if insufficient on confirm", async () => {
        mockUsdc.balanceOf.mockResolvedValue(ethers.parseUnits("50", 6)); // only 50 USDC
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.editMessageText).toHaveBeenCalledWith(
            expect.stringContaining("Insufficient USDC balance"),
            expect.any(Object)
        );
    });

    it("should prompt for approval when allowance is too low", async () => {
        mockUsdc.allowance.mockResolvedValue(0n);
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.editMessageText).toHaveBeenCalledWith(
            "Approval required to spend USDC.",
            expect.objectContaining({
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Approve via Circle", callback_data: "approve_12345" },
                            { text: "Cancel", callback_data: "cancel_12345" }
                        ]
                    ]
                }
            })
        );
    });

    it("should execute circle transaction directly when allowance is sufficient", async () => {
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));

        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(mockCircleClient.createTransaction).toHaveBeenCalledTimes(1); // the router pay call
        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith("circle-wallet-123", "0xRouter", "0xencodedPay");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment submitted to Circle"), expect.any(Object));
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed on Circle"), expect.any(Object));
    });

    it("should approve via circle then pay via circle when user clicks Approve", async () => {
        // speed up the setTimeout in processCallback
        vi.useFakeTimers();

        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        const processPromise = engine.processCallback({
            id: "q1",
            data: "approve_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        // Advance timers logic
        await vi.advanceTimersByTimeAsync(7000);
        await processPromise;

        expect(mockCircleClient.createTransaction).toHaveBeenCalledTimes(2);
        // 1. the approve
        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith("circle-wallet-123", "0xUSDC", "0xencodedApprove");
        // 2. the pay
        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith("circle-wallet-123", "0xRouter", "0xencodedPay");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment submitted to Circle"), expect.any(Object));
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed on Circle"), expect.any(Object));

        vi.useRealTimers();
    });

    it("should cancel payment and clear state", async () => {
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        await engine.processCallback({
            id: "q1",
            data: "cancel_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.editMessageText).toHaveBeenCalledWith("Payment cancelled.", expect.any(Object));
    });

    it("should handle expired payment session", async () => {
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);

        // No preparePayment called, so no pending payment exists
        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.answerCallbackQuery).toHaveBeenCalledWith("q1", { text: "Payment session expired or not found." });
    });

    it("should handle circle transaction failure gracefully", async () => {
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));
        mockCircleClient.createTransaction.mockRejectedValue(new Error("transfer_failed"));

        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "50");

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            12345,
            expect.stringContaining("USDC transfer failed")
        );
    });
});
