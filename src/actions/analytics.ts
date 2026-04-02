import { registerAction } from "./registry";
import type { AnalyticsEngine } from "../engines/analytics";

export interface AnalyticsActionDeps {
    analyticsEngine: AnalyticsEngine;
}

export function registerAnalyticsActions(deps: AnalyticsActionDeps): void {
    registerAction("report", async (chatId, params) => {
        await deps.analyticsEngine.report(chatId, params.period || "all");
    });

    registerAction("spending_by_vendor", async (chatId) => {
        await deps.analyticsEngine.spendingByVendor(chatId);
    });

    registerAction("monthly_spending", async (chatId) => {
        await deps.analyticsEngine.monthlySpending(chatId);
    });

    registerAction("show_recent_payments", async (chatId) => {
        await deps.analyticsEngine.recentPayments(chatId);
    });

    registerAction("account_summary", async (chatId) => {
        await deps.analyticsEngine.accountSummary(chatId);
    });

    registerAction("status", async (chatId) => {
        await deps.analyticsEngine.status(chatId);
    });

    registerAction("top_vendors", async (chatId) => {
        await deps.analyticsEngine.topVendors(chatId);
    });
}
