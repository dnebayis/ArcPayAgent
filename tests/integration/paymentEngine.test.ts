import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentEngine } from "../../src/engines/paymentEngine";
import { ethers } from "ethers";
import { PendingPaymentStore } from "../../src/storage/pendingPayments";
import { SubmittedTransactionStore } from "../../src/storage/submittedTransactions";
import { ARC_TESTNET_CHAIN_ID } from "../../src/blockchain/arcConfig";

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

        mockProvider = {
            getNetwork: vi.fn().mockResolvedValue({ chainId: ARC_TESTNET_CHAIN_ID })
        };
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
            expect.stringContaining("Review payment"),
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
            expect.stringContaining("Insufficient balance"),
            expect.any(Object)
        );
    });

    it("should reject payment when balance does not cover Arc gas reserve", async () => {
        mockUsdc.balanceOf.mockResolvedValue(ethers.parseUnits("100.05", 6));
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));
        const previousReserve = process.env.ARC_GAS_RESERVE_USDC;
        process.env.ARC_GAS_RESERVE_USDC = "0.10";

        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.editMessageText).toHaveBeenCalledWith(
            expect.stringContaining("Arc gas reserve"),
            expect.any(Object)
        );

        process.env.ARC_GAS_RESERVE_USDC = previousReserve;
    });

    it("should reject payment when provider is not on Arc Testnet", async () => {
        mockProvider.getNetwork.mockResolvedValue({ chainId: 1n });
        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.editMessageText).toHaveBeenCalledWith(
            expect.stringContaining("Arc network mismatch"),
            expect.any(Object)
        );
        expect(mockCircleClient.createTransaction).not.toHaveBeenCalled();
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
            expect.stringContaining("Approval required before payment"),
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
        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith("circle-wallet-123", "0xRouter", "0xencodedPay", expect.any(String));

        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment submitted"), expect.any(Object));
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed"), expect.any(Object));
    });

    it("should run the onConfirmed hook only after payment confirmation", async () => {
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));
        const onConfirmed = vi.fn();

        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100", "ArcPay", { onConfirmed });

        expect(onConfirmed).not.toHaveBeenCalled();

        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: 'private' }, message_id: 1, date: 0 }
        } as any);

        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it("should recover a pending payment from storage after restart", async () => {
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));
        const pendingPaymentStore = new PendingPaymentStore();
        const submittedTransactionStore = new SubmittedTransactionStore();
        const postConfirmHandler = vi.fn();

        const firstEngine = new PaymentEngine(
            mockBot,
            mockUsdc,
            mockRouter,
            "0xRouter",
            mockWalletStore,
            mockVendorStore,
            mockProvider,
            mockPaymentLogStore,
            mockCircleClient,
            undefined,
            undefined,
            pendingPaymentStore,
            submittedTransactionStore,
            postConfirmHandler
        );

        await firstEngine.preparePayment(
            12345,
            "0x0000000000000000000000000000000000000001",
            "100",
            "ArcPay",
            {
                source: {
                    type: "request",
                    requestId: "req-1",
                    originChatId: 12345,
                    originMessageId: 50
                }
            }
        );

        const restartedBot = {
            sendMessage: vi.fn(),
            editMessageText: vi.fn(),
            answerCallbackQuery: vi.fn(),
        };

        const restartedEngine = new PaymentEngine(
            restartedBot as any,
            mockUsdc,
            mockRouter,
            "0xRouter",
            mockWalletStore,
            mockVendorStore,
            mockProvider,
            mockPaymentLogStore,
            mockCircleClient,
            undefined,
            undefined,
            pendingPaymentStore,
            submittedTransactionStore,
            postConfirmHandler
        );

        await restartedEngine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        expect(postConfirmHandler).toHaveBeenCalledWith(
            12345,
            expect.objectContaining({
                beneficiary: "0x0000000000000000000000000000000000000001",
                source: expect.objectContaining({
                    type: "request",
                    requestId: "req-1"
                })
            })
        );
        expect(restartedBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed"), expect.any(Object));
    });

    it("should reject duplicate callback processing while a payment is in flight", async () => {
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));
        let releasePoll: (() => void) | null = null;
        mockCircleClient.waitForTerminalTransaction.mockImplementation(() => new Promise((resolve) => {
            releasePoll = () => resolve({ id: "circle-tx-999", state: "COMPLETE", txHash: null, errorReason: null, errorDetails: null });
        }));

        const engine = new PaymentEngine(mockBot, mockUsdc, mockRouter, "0xRouter", mockWalletStore, mockVendorStore, mockProvider, mockPaymentLogStore, mockCircleClient);
        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");

        const first = engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        await vi.waitFor(() => {
            expect(mockCircleClient.createTransaction).toHaveBeenCalledTimes(1);
        });

        await engine.processCallback({
            id: "q2",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        expect(mockBot.answerCallbackQuery).toHaveBeenCalledWith("q2", { text: "This payment is already processing." });
        expect(mockCircleClient.createTransaction).toHaveBeenCalledTimes(1);

        releasePoll?.();
        await first;
    });

    it("should reconcile a submitted payment that reaches final state later", async () => {
        mockUsdc.allowance.mockResolvedValue(ethers.parseUnits("1000", 6));
        mockCircleClient.waitForTerminalTransaction.mockResolvedValue(null);
        mockCircleClient.getTransaction = vi.fn().mockResolvedValue({
            id: "circle-tx-999",
            state: "COMPLETE",
            txHash: null,
            errorReason: null,
            errorDetails: null
        });

        const submittedTransactionStore = new SubmittedTransactionStore();
        const engine = new PaymentEngine(
            mockBot,
            mockUsdc,
            mockRouter,
            "0xRouter",
            mockWalletStore,
            mockVendorStore,
            mockProvider,
            mockPaymentLogStore,
            mockCircleClient,
            undefined,
            undefined,
            undefined,
            submittedTransactionStore
        );

        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");
        await engine.processCallback({
            id: "q1",
            data: "confirm_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        expect(submittedTransactionStore.get(12345)).not.toBeNull();

        await engine.reconcileSubmittedTransactions();

        expect(submittedTransactionStore.get(12345)).toBeNull();
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed"), expect.any(Object));
    });

    it("should recover a creating payment submission by reusing the same idempotency key", async () => {
        const submittedTransactionStore = new SubmittedTransactionStore();
        submittedTransactionStore.set({
            chatId: 12345,
            txId: null,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
            status: "creating",
            context: "payment",
            walletId: "circle-wallet-123",
            beneficiary: "0x0000000000000000000000000000000000000001",
            vendorName: null,
            amountStr: "100",
            amount: ethers.parseUnits("100", 6).toString(),
            memo: "ArcPay",
            submittedAt: Date.now()
        });
        mockCircleClient.createTransaction.mockResolvedValue("circle-tx-999");
        mockCircleClient.getTransaction = vi.fn().mockResolvedValue({
            id: "circle-tx-999",
            state: "COMPLETE",
            txHash: null,
            errorReason: null,
            errorDetails: null
        });

        const engine = new PaymentEngine(
            mockBot,
            mockUsdc,
            mockRouter,
            "0xRouter",
            mockWalletStore,
            mockVendorStore,
            mockProvider,
            mockPaymentLogStore,
            mockCircleClient,
            undefined,
            undefined,
            undefined,
            submittedTransactionStore
        );

        await engine.reconcileSubmittedTransactions();

        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith(
            "circle-wallet-123",
            "0xRouter",
            "0xencodedPay",
            "11111111-1111-4111-8111-111111111111"
        );
        expect(submittedTransactionStore.get(12345)).toBeNull();
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed"), expect.any(Object));
    });

    it("should reconcile a submitted approval and continue to payment", async () => {
        mockCircleClient.waitForTerminalTransaction.mockResolvedValue(null);
        mockCircleClient.getTransaction = vi.fn().mockResolvedValue({
            id: "circle-tx-999",
            state: "COMPLETE",
            txHash: null,
            errorReason: null,
            errorDetails: null
        });

        const submittedTransactionStore = new SubmittedTransactionStore();
        const engine = new PaymentEngine(
            mockBot,
            mockUsdc,
            mockRouter,
            "0xRouter",
            mockWalletStore,
            mockVendorStore,
            mockProvider,
            mockPaymentLogStore,
            mockCircleClient,
            undefined,
            undefined,
            undefined,
            submittedTransactionStore
        );

        await engine.preparePayment(12345, "0x0000000000000000000000000000000000000001", "100");
        await engine.processCallback({
            id: "q1",
            data: "approve_12345",
            from: { id: 12345, is_bot: false, first_name: "Test" },
            message: { chat: { id: 12345, type: "private" }, message_id: 1, date: 0 }
        } as any);

        expect(submittedTransactionStore.get(12345)?.context).toBe("approval");

        await engine.reconcileSubmittedTransactions();

        expect(mockCircleClient.createTransaction).toHaveBeenNthCalledWith(2, "circle-wallet-123", "0xRouter", "0xencodedPay", expect.any(String));
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
        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith("circle-wallet-123", "0xUSDC", "0xencodedApprove", expect.any(String));
        // 2. the pay
        expect(mockCircleClient.createTransaction).toHaveBeenCalledWith("circle-wallet-123", "0xRouter", "0xencodedPay", expect.any(String));

        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment submitted"), expect.any(Object));
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("Payment confirmed"), expect.any(Object));

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
