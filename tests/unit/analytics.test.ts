import { describe, it, expect, vi } from "vitest";
import { PaymentLogStore } from "../../src/storage/paymentLogs";
import { AnalyticsEngine } from "../../src/engines/analyticsEngine";

describe("PaymentLogStore", () => {
    it("should log and retrieve payments", () => {
        const store = new PaymentLogStore();

        store.logPayment(1, {
            vendor: "aws",
            address: "0x001",
            amount: 50,
            timestamp: Date.now(),
            memo: "ArcPay",
            txHash: "0xabc"
        });

        const payments = store.getPayments(1);
        expect(payments.length).toBe(1);
        expect(payments[0].vendor).toBe("aws");
        expect(payments[0].amount).toBe(50);
    });

    it("should filter payments by time", () => {
        const store = new PaymentLogStore();
        const now = Date.now();

        store.logPayment(1, {
            vendor: "old",
            address: "0x001",
            amount: 10,
            timestamp: now - 60 * 24 * 60 * 60 * 1000, // 60 days ago
            memo: "",
            txHash: "0x1"
        });

        store.logPayment(1, {
            vendor: "recent",
            address: "0x002",
            amount: 20,
            timestamp: now - 5 * 24 * 60 * 60 * 1000, // 5 days ago
            memo: "",
            txHash: "0x2"
        });

        const since30d = now - 30 * 24 * 60 * 60 * 1000;
        const recent = store.getPaymentsSince(1, since30d);
        expect(recent.length).toBe(1);
        expect(recent[0].vendor).toBe("recent");
    });

    it("should get recent payments with limit", () => {
        const store = new PaymentLogStore();

        for (let i = 0; i < 15; i++) {
            store.logPayment(1, {
                vendor: `vendor_${i}`,
                address: "0x001",
                amount: 10,
                timestamp: Date.now() + i,
                memo: "",
                txHash: `0x${i}`
            });
        }

        const recent = store.getRecentPayments(1, 5);
        expect(recent.length).toBe(5);
        expect(recent[0].vendor).toBe("vendor_10");
    });

    it("should isolate payments per user", () => {
        const store = new PaymentLogStore();

        store.logPayment(1, {
            vendor: "aws", address: "0x1", amount: 50,
            timestamp: Date.now(), memo: "", txHash: "0x1"
        });
        store.logPayment(2, {
            vendor: "gcp", address: "0x2", amount: 30,
            timestamp: Date.now(), memo: "", txHash: "0x2"
        });

        expect(store.getPayments(1).length).toBe(1);
        expect(store.getPayments(2).length).toBe(1);
        expect(store.getPayments(1)[0].vendor).toBe("aws");
    });
});

describe("AnalyticsEngine", () => {
    function createEngine() {
        const mockBot = {
            sendMessage: vi.fn()
        } as any;
        const store = new PaymentLogStore();
        const engine = new AnalyticsEngine(mockBot, store);
        return { mockBot, store, engine };
    }

    it("should calculate total spending", () => {
        const { store, engine } = createEngine();

        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 50, timestamp: Date.now(), memo: "", txHash: "0x1" });
        store.logPayment(1, { vendor: "gcp", address: "0x2", amount: 30, timestamp: Date.now(), memo: "", txHash: "0x2" });

        expect(engine.getTotalSpending(1)).toBe(80);
    });

    it("should calculate spending by vendor sorted by total", () => {
        const { store, engine } = createEngine();

        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 50, timestamp: Date.now(), memo: "", txHash: "0x1" });
        store.logPayment(1, { vendor: "gcp", address: "0x2", amount: 30, timestamp: Date.now(), memo: "", txHash: "0x2" });
        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 70, timestamp: Date.now(), memo: "", txHash: "0x3" });

        const byVendor = engine.getSpendingByVendor(1);
        expect(byVendor.length).toBe(2);
        expect(byVendor[0].vendor).toBe("aws");
        expect(byVendor[0].total).toBe(120);
        expect(byVendor[0].count).toBe(2);
        expect(byVendor[1].vendor).toBe("gcp");
        expect(byVendor[1].total).toBe(30);
    });

    it("should calculate monthly spending", () => {
        const { store, engine } = createEngine();

        // January payment
        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 50, timestamp: new Date("2026-01-15").getTime(), memo: "", txHash: "0x1" });
        // February payment
        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 30, timestamp: new Date("2026-02-10").getTime(), memo: "", txHash: "0x2" });

        const monthly = engine.getMonthlySpending(1);
        expect(monthly.length).toBe(2);
        expect(monthly[0].month).toBe("2026-01");
        expect(monthly[0].total).toBe(50);
        expect(monthly[1].month).toBe("2026-02");
        expect(monthly[1].total).toBe(30);
    });

    it("should show report message with vendor breakdown", () => {
        const { mockBot, store, engine } = createEngine();

        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 120, timestamp: Date.now(), memo: "", txHash: "0x1" });
        store.logPayment(1, { vendor: "openai", address: "0x2", amount: 35, timestamp: Date.now(), memo: "", txHash: "0x2" });

        engine.showReport(1, "month");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("Spending Report"),
            expect.any(Object)
        );
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("aws"),
            expect.any(Object)
        );
        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("Total: 155 USDC"),
            expect.any(Object)
        );
    });

    it("should show empty state when no payments", () => {
        const { mockBot, engine } = createEngine();

        engine.showReport(1, "month");

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("No payments recorded")
        );
    });

    it("should show payment history", () => {
        const { mockBot, store, engine } = createEngine();

        store.logPayment(1, { vendor: "aws", address: "0x1", amount: 50, timestamp: Date.now(), memo: "", txHash: "0x1" });

        engine.showHistory(1);

        expect(mockBot.sendMessage).toHaveBeenCalledWith(
            1,
            expect.stringContaining("Recent Payments"),
            expect.any(Object)
        );
    });

    it("should filter spending by time period", () => {
        const { store, engine } = createEngine();
        const now = Date.now();

        store.logPayment(1, { vendor: "old", address: "0x1", amount: 100, timestamp: now - 60 * 24 * 60 * 60 * 1000, memo: "", txHash: "0x1" });
        store.logPayment(1, { vendor: "recent", address: "0x2", amount: 50, timestamp: now, memo: "", txHash: "0x2" });

        const since30d = now - 30 * 24 * 60 * 60 * 1000;
        expect(engine.getTotalSpending(1, since30d)).toBe(50);
        expect(engine.getTotalSpending(1)).toBe(150);
    });
});
