import { describe, it, expect, vi } from "vitest";
import { RouterReader, RouterPaymentEvent } from "../../src/blockchain/routerReader";

describe("RouterReader", () => {

    it("should return no pending payments because router executes immediately", async () => {
        const reader = new RouterReader(null as any, "0x0000000000000000000000000000000000000000");

        const pending = await reader.getPendingPayments("0x123");
        expect(pending).toEqual([]);
    });

    it("should return executed payments as recent payments", async () => {
        const reader = new RouterReader(null as any, "0x0000000000000000000000000000000000000000");

        const mockEvents: RouterPaymentEvent[] = [
            { type: "Executed", sender: "0x123", recipient: "0xABC", amount: 5000000n, timestamp: 101, transactionHash: "tx2", memo: "" },
            { type: "Executed", sender: "0x123", recipient: "0xGHI", amount: 1000000n, timestamp: 110, transactionHash: "tx3", memo: "" },
        ];

        vi.spyOn(reader, "getRouterEvents").mockResolvedValue(mockEvents);

        const recent = await reader.getRecentPayments("0x123");
        expect(recent.length).toBe(2);

        // Types should be executed only for the current router reader.
        const types = recent.map(r => r.type);
        expect(types).toContain("Executed");
        expect(types).not.toContain("Created");
    });
});
