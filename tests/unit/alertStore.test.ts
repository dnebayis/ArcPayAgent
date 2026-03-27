import { describe, it, expect, beforeEach } from "vitest";
import { AlertStore } from "../../src/storage/alertStore";

describe("AlertStore", () => {
    let store: AlertStore;

    beforeEach(() => {
        store = new AlertStore();
    });

    // ── Initial state ─────────────────────────────────────────────────────────

    describe("initial state", () => {
        it("returns empty array for a new user", () => {
            expect(store.getAlerts(1)).toHaveLength(0);
        });

        it("returns empty array for getAllActive when nothing exists", () => {
            expect(store.getAllActive()).toHaveLength(0);
        });
    });

    // ── createAlert ───────────────────────────────────────────────────────────

    describe("createAlert", () => {
        it("creates an alert with the correct fields", () => {
            const alert = store.createAlert(1, "BTC", 100000, "above");
            expect(alert.chatId).toBe(1);
            expect(alert.symbol).toBe("BTC");
            expect(alert.targetPrice).toBe(100000);
            expect(alert.direction).toBe("above");
            expect(alert.triggered).toBe(false);
        });

        it("generates a unique ID for each alert", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            const a2 = store.createAlert(1, "ETH", 2000, "below");
            expect(a1.id).toBeTruthy();
            expect(a2.id).toBeTruthy();
            expect(a1.id).not.toBe(a2.id);
        });

        it("stores the createdAt timestamp", () => {
            const before = Date.now();
            const alert = store.createAlert(1, "BTC", 100000, "above");
            const after = Date.now();
            expect(alert.createdAt).toBeGreaterThanOrEqual(before);
            expect(alert.createdAt).toBeLessThanOrEqual(after);
        });

        it("supports the above direction", () => {
            const alert = store.createAlert(1, "BTC", 100000, "above");
            expect(alert.direction).toBe("above");
        });

        it("supports the below direction", () => {
            const alert = store.createAlert(1, "ETH", 1000, "below");
            expect(alert.direction).toBe("below");
        });

        it("normalizes symbol to uppercase", () => {
            const alert = store.createAlert(1, "btc", 100000, "above");
            expect(alert.symbol).toBe("BTC");
        });

        it("allows multiple alerts for the same user", () => {
            store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.createAlert(1, "SOL", 200, "above");
            expect(store.getAlerts(1)).toHaveLength(3);
        });
    });

    // ── getAlerts ─────────────────────────────────────────────────────────────

    describe("getAlerts", () => {
        it("returns only untriggered alerts for the user", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.markTriggered(a1.id);
            const alerts = store.getAlerts(1);
            expect(alerts).toHaveLength(1);
            expect(alerts[0].symbol).toBe("ETH");
        });

        it("returns empty after all alerts are triggered", () => {
            const alert = store.createAlert(1, "BTC", 100000, "above");
            store.markTriggered(alert.id);
            expect(store.getAlerts(1)).toHaveLength(0);
        });
    });

    // ── getAllActive ──────────────────────────────────────────────────────────

    describe("getAllActive", () => {
        it("returns untriggered alerts across all users", () => {
            store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(2, "ETH", 3000, "below");
            expect(store.getAllActive()).toHaveLength(2);
        });

        it("excludes triggered alerts from all users", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(2, "ETH", 3000, "below");
            store.markTriggered(a1.id);
            const active = store.getAllActive();
            expect(active).toHaveLength(1);
            expect(active[0].chatId).toBe(2);
        });

        it("returns empty when all alerts are triggered", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            const a2 = store.createAlert(2, "ETH", 3000, "below");
            store.markTriggered(a1.id);
            store.markTriggered(a2.id);
            expect(store.getAllActive()).toHaveLength(0);
        });
    });

    // ── markTriggered ─────────────────────────────────────────────────────────

    describe("markTriggered", () => {
        it("excludes the alert from getAlerts after triggering", () => {
            const alert = store.createAlert(1, "BTC", 100000, "above");
            store.markTriggered(alert.id);
            expect(store.getAlerts(1)).toHaveLength(0);
        });

        it("excludes the alert from getAllActive after triggering", () => {
            const alert = store.createAlert(1, "BTC", 100000, "above");
            store.markTriggered(alert.id);
            expect(store.getAllActive()).toHaveLength(0);
        });

        it("only affects the targeted alert, not others", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.markTriggered(a1.id);
            expect(store.getAlerts(1)).toHaveLength(1);
            expect(store.getAlerts(1)[0].symbol).toBe("ETH");
        });

        it("does not throw for an unknown alert ID", () => {
            expect(() => store.markTriggered("nonexistent-id")).not.toThrow();
        });
    });

    // ── removeAlert ───────────────────────────────────────────────────────────

    describe("removeAlert", () => {
        it("removes the specified alert by chatId + ID", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.removeAlert(1, a1.id);
            const alerts = store.getAlerts(1);
            expect(alerts).toHaveLength(1);
            expect(alerts[0].symbol).toBe("ETH");
        });

        it("does not affect other users' alerts", () => {
            const a1 = store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(2, "ETH", 3000, "below");
            store.removeAlert(1, a1.id);
            expect(store.getAlerts(2)).toHaveLength(1);
        });

        it("does not throw for an unknown ID", () => {
            expect(() => store.removeAlert(1, "ghost-id")).not.toThrow();
        });
    });

    // ── removeAllAlerts ───────────────────────────────────────────────────────

    describe("removeAllAlerts", () => {
        it("removes all alerts for the specified user", () => {
            store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.removeAllAlerts(1);
            expect(store.getAlerts(1)).toHaveLength(0);
        });

        it("does not affect other users when removing all for one user", () => {
            store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(2, "SOL", 50, "above");
            store.removeAllAlerts(1);
            expect(store.getAlerts(2)).toHaveLength(1);
        });

        it("does not throw when user has no alerts", () => {
            expect(() => store.removeAllAlerts(99)).not.toThrow();
        });

        it("also removes from getAllActive", () => {
            store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.createAlert(2, "SOL", 50, "above");
            store.removeAllAlerts(1);
            expect(store.getAllActive()).toHaveLength(1);
            expect(store.getAllActive()[0].chatId).toBe(2);
        });
    });

    // ── Per-user isolation ────────────────────────────────────────────────────

    describe("per-user isolation", () => {
        it("does not expose user 1 alerts to user 2", () => {
            store.createAlert(1, "BTC", 100000, "above");
            expect(store.getAlerts(2)).toHaveLength(0);
        });

        it("maintains separate alert lists per user", () => {
            store.createAlert(1, "BTC", 100000, "above");
            store.createAlert(1, "ETH", 2000, "below");
            store.createAlert(2, "SOL", 50, "above");
            expect(store.getAlerts(1)).toHaveLength(2);
            expect(store.getAlerts(2)).toHaveLength(1);
        });
    });
});
