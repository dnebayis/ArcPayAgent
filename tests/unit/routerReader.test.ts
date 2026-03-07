import { describe, it, expect, vi } from "vitest";
import { RouterReader, RouterPaymentEvent } from "../../src/blockchain/routerReader";

describe("RouterReader", () => {

    it("should filter pending payments correctly", async () => {
        // Since we want to test the filtering logic without a real node,
        // we can cast RouterReader and override getRouterEvents.
        const reader = new RouterReader(null as any, "0x0000000000000000000000000000000000000000");

        // mock the internal events
        const mockEvents: RouterPaymentEvent[] = [
            // A fully finished payment
            { type: "Created", sender: "0x123", recipient: "0xABC", amount: 5000000n, timestamp: 100, transactionHash: "tx1", memo: "" },
            { type: "Executed", sender: "0x123", recipient: "0xABC", amount: 5000000n, timestamp: 101, transactionHash: "tx2" },

            // A pending payment (no matching Executed/Settled)
            { type: "Created", sender: "0x123", recipient: "0xDEF", amount: 3000000n, timestamp: 105, transactionHash: "tx3", memo: "" },

            // Another finished payment but tested out of order
            { type: "Settled", sender: "0x123", recipient: "0xGHI", amount: 1000000n, timestamp: 110, transactionHash: "tx4" },
            { type: "Created", sender: "0x123", recipient: "0xGHI", amount: 1000000n, timestamp: 109, transactionHash: "tx5", memo: "" }
        ];

        vi.spyOn(reader, "getRouterEvents").mockResolvedValue(mockEvents);

        const pending = await reader.getPendingPayments("0x123");
        expect(pending.length).toBe(1);
        expect(pending[0].recipient).toBe("0xDEF");
        expect(pending[0].amount).toBe(3000000n);
    });

    it("should return executed and settled as recent payments", async () => {
        const reader = new RouterReader(null as any, "0x0000000000000000000000000000000000000000");

        const mockEvents: RouterPaymentEvent[] = [
            { type: "Created", sender: "0x123", recipient: "0xABC", amount: 5000000n, timestamp: 100, transactionHash: "tx1", memo: "" },
            { type: "Executed", sender: "0x123", recipient: "0xABC", amount: 5000000n, timestamp: 101, transactionHash: "tx2" },
            { type: "Settled", sender: "0x123", recipient: "0xGHI", amount: 1000000n, timestamp: 110, transactionHash: "tx3" },
        ];

        vi.spyOn(reader, "getRouterEvents").mockResolvedValue(mockEvents);

        const recent = await reader.getRecentPayments("0x123");
        expect(recent.length).toBe(2);

        // Types should be only Executed or Settled
        const types = recent.map(r => r.type);
        expect(types).toContain("Executed");
        expect(types).toContain("Settled");
        expect(types).not.toContain("Created");
    });
});

