import { describe, it, expect, beforeEach } from "vitest";
import { WatchStore } from "../../src/storage/watchStore";

describe("WatchStore", () => {
    let store: WatchStore;

    beforeEach(() => {
        store = new WatchStore();
    });

    // ── Initial state ─────────────────────────────────────────────────────────

    describe("initial state", () => {
        it("returns false for isEnabled on a new user", () => {
            expect(store.isEnabled(1)).toBe(false);
        });

        it("returns null for getSettings on a new user", () => {
            expect(store.getSettings(1)).toBeNull();
        });

        it("returns empty array for getAllEnabled when nothing is active", () => {
            expect(store.getAllEnabled()).toHaveLength(0);
        });
    });

    // ── enable ────────────────────────────────────────────────────────────────

    describe("enable", () => {
        it("marks the user as enabled", () => {
            store.enable(1, "0xabc", "1000000", "0");
            expect(store.isEnabled(1)).toBe(true);
        });

        it("persists wallet address and initial balances", () => {
            store.enable(1, "0xabc123", "5000000", "2000000");
            const settings = store.getSettings(1);
            expect(settings?.walletAddress).toBe("0xabc123");
            expect(settings?.lastKnownUsdcBalance).toBe("5000000");
            expect(settings?.lastKnownEurcBalance).toBe("2000000");
            expect(settings?.enabled).toBe(true);
        });

        it("sets enabledAt timestamp", () => {
            const before = Date.now();
            store.enable(1, "0xabc", "0", "0");
            const after = Date.now();
            const settings = store.getSettings(1);
            expect(settings?.enabledAt).toBeGreaterThanOrEqual(before);
            expect(settings?.enabledAt).toBeLessThanOrEqual(after);
        });

        it("overwrites existing settings when called again", () => {
            store.enable(1, "0xabc", "1000000", "0");
            store.enable(1, "0xdef", "9000000", "100");
            const settings = store.getSettings(1);
            expect(settings?.walletAddress).toBe("0xdef");
            expect(settings?.lastKnownUsdcBalance).toBe("9000000");
        });
    });

    // ── disable ───────────────────────────────────────────────────────────────

    describe("disable", () => {
        it("marks an enabled user as disabled", () => {
            store.enable(1, "0xabc", "1000000", "0");
            store.disable(1);
            expect(store.isEnabled(1)).toBe(false);
        });

        it("removes from getAllEnabled after disable", () => {
            store.enable(1, "0xabc", "1000000", "0");
            store.disable(1);
            expect(store.getAllEnabled()).toHaveLength(0);
        });

        it("does not throw when called on a user who was never enabled", () => {
            expect(() => store.disable(99)).not.toThrow();
        });
    });

    // ── getAllEnabled ─────────────────────────────────────────────────────────

    describe("getAllEnabled", () => {
        it("returns all currently enabled entries", () => {
            store.enable(1, "0xaaa", "1000000", "0");
            store.enable(2, "0xbbb", "2000000", "0");
            const enabled = store.getAllEnabled();
            expect(enabled).toHaveLength(2);
            expect(enabled.map((s) => s.chatId).sort()).toEqual([1, 2]);
        });

        it("excludes disabled entries", () => {
            store.enable(1, "0xaaa", "1000000", "0");
            store.enable(2, "0xbbb", "2000000", "0");
            store.disable(2);
            const enabled = store.getAllEnabled();
            expect(enabled).toHaveLength(1);
            expect(enabled[0].chatId).toBe(1);
        });

        it("returns empty after all users are disabled", () => {
            store.enable(1, "0xaaa", "0", "0");
            store.disable(1);
            expect(store.getAllEnabled()).toHaveLength(0);
        });
    });

    // ── updateBalances ────────────────────────────────────────────────────────

    describe("updateBalances", () => {
        it("updates USDC balance", () => {
            store.enable(1, "0xabc", "1000000", "0");
            store.updateBalances(1, "2000000", "0");
            expect(store.getSettings(1)?.lastKnownUsdcBalance).toBe("2000000");
        });

        it("updates EURC balance", () => {
            store.enable(1, "0xabc", "0", "500000");
            store.updateBalances(1, "0", "750000");
            expect(store.getSettings(1)?.lastKnownEurcBalance).toBe("750000");
        });

        it("updates both balances simultaneously", () => {
            store.enable(1, "0xabc", "1000000", "500000");
            store.updateBalances(1, "3000000", "800000");
            const settings = store.getSettings(1);
            expect(settings?.lastKnownUsdcBalance).toBe("3000000");
            expect(settings?.lastKnownEurcBalance).toBe("800000");
        });

        it("does not throw when called for a non-existent user", () => {
            expect(() => store.updateBalances(99, "1000", "0")).not.toThrow();
        });

        it("preserves enabled state and wallet address after update", () => {
            store.enable(1, "0xabc", "1000000", "0");
            store.updateBalances(1, "2000000", "0");
            expect(store.isEnabled(1)).toBe(true);
            expect(store.getSettings(1)?.walletAddress).toBe("0xabc");
        });
    });

    // ── Per-user isolation ────────────────────────────────────────────────────

    describe("per-user isolation", () => {
        it("does not leak state between different chat IDs", () => {
            store.enable(1, "0xaaa", "1000000", "0");
            expect(store.isEnabled(2)).toBe(false);
            expect(store.getSettings(2)).toBeNull();
        });

        it("updates for one user do not affect another", () => {
            store.enable(1, "0xaaa", "1000000", "0");
            store.enable(2, "0xbbb", "2000000", "0");
            store.updateBalances(1, "9999999", "0");
            expect(store.getSettings(2)?.lastKnownUsdcBalance).toBe("2000000");
        });

        it("disabling one user does not affect another", () => {
            store.enable(1, "0xaaa", "0", "0");
            store.enable(2, "0xbbb", "0", "0");
            store.disable(1);
            expect(store.isEnabled(2)).toBe(true);
        });
    });
});
