import { registerAction } from "./registry";
import type { AnalyticsEngine } from "../engines/analytics";
import type { PaymentLogStore } from "../store/payments";
import { paymentsToCSV } from "../utils/csv";

export interface AnalyticsActionDeps {
    analyticsEngine: AnalyticsEngine;
    paymentLog: PaymentLogStore;
    send: (chatId: number, text: string) => Promise<void>;
    sendDocument: (chatId: number, buffer: Buffer, filename: string, caption?: string) => Promise<void>;
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

    registerAction("export_payments", async (chatId, params) => {
        const period = params.period ?? "all";
        const since = period === "week"  ? Date.now() - 7  * 86_400_000
                    : period === "month" ? Date.now() - 30 * 86_400_000
                    : 0;
        const payments = since > 0
            ? await deps.paymentLog.getPaymentsSince(chatId, since)
            : await deps.paymentLog.getPayments(chatId);
        if (payments.length === 0) {
            await deps.send(chatId, "No payments found for this period.");
            return;
        }
        const csv = paymentsToCSV(payments);
        const label = period === "week" ? "last-7-days" : period === "month" ? "last-30-days" : "all";
        await deps.sendDocument(chatId, csv, `payments-${label}.csv`, `${payments.length} payment(s) exported.`);
    });
}
