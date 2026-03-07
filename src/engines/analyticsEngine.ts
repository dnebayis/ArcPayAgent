import TelegramBot from "node-telegram-bot-api";
import { PaymentLogStore, PaymentLogEntry } from "../storage/paymentLogs";

export class AnalyticsEngine {
    constructor(
        private bot: TelegramBot,
        private paymentLogs: PaymentLogStore
    ) { }

    /**
     * Total spending (all time or since a given timestamp)
     */
    getTotalSpending(chatId: number, since?: number): number {
        const payments = since
            ? this.paymentLogs.getPaymentsSince(chatId, since)
            : this.paymentLogs.getPayments(chatId);
        return payments.reduce((sum, p) => sum + p.amount, 0);
    }

    /**
     * Spending grouped by vendor
     */
    getSpendingByVendor(chatId: number, since?: number): { vendor: string; total: number; count: number }[] {
        const payments = since
            ? this.paymentLogs.getPaymentsSince(chatId, since)
            : this.paymentLogs.getPayments(chatId);

        const map: Record<string, { total: number; count: number }> = {};
        for (const p of payments) {
            const key = p.vendor || p.address.slice(0, 10);
            if (!map[key]) map[key] = { total: 0, count: 0 };
            map[key].total += p.amount;
            map[key].count += 1;
        }

        return Object.entries(map)
            .map(([vendor, data]) => ({ vendor, total: data.total, count: data.count }))
            .sort((a, b) => b.total - a.total);
    }

    /**
     * Monthly spending breakdown
     */
    getMonthlySpending(chatId: number): { month: string; total: number }[] {
        const payments = this.paymentLogs.getPayments(chatId);
        const map: Record<string, number> = {};

        for (const p of payments) {
            const d = new Date(p.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            map[key] = (map[key] || 0) + p.amount;
        }

        return Object.entries(map)
            .map(([month, total]) => ({ month, total }))
            .sort((a, b) => a.month.localeCompare(b.month));
    }

    /**
     * Show spending report to user
     */
    showReport(chatId: number, period: "all" | "month" | "week" = "month"): void {
        const now = Date.now();
        let since: number | undefined;
        let periodLabel = "All Time";

        if (period === "month") {
            since = now - 30 * 24 * 60 * 60 * 1000;
            periodLabel = "Last 30 Days";
        } else if (period === "week") {
            since = now - 7 * 24 * 60 * 60 * 1000;
            periodLabel = "Last 7 Days";
        }

        const total = this.getTotalSpending(chatId, since);
        const byVendor = this.getSpendingByVendor(chatId, since);

        if (total === 0) {
            this.bot.sendMessage(chatId, "📊 No payments recorded yet. Start sending payments to see your analytics!");
            return;
        }

        let msg = `📊 **Spending Report — ${periodLabel}**\n\n`;

        if (byVendor.length > 0) {
            for (const v of byVendor) {
                const pct = ((v.total / total) * 100).toFixed(0);
                msg += `• **${v.vendor}** → ${v.total} USDC (${v.count} payments, ${pct}%)\n`;
            }
            msg += `\n💰 **Total: ${total} USDC**`;
        }

        this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    /**
     * Show recent payment history
     */
    showHistory(chatId: number, limit: number = 10): void {
        const recent = this.paymentLogs.getRecentPayments(chatId, limit);

        if (recent.length === 0) {
            this.bot.sendMessage(chatId, "📜 No payment history yet.");
            return;
        }

        let msg = `📜 **Recent Payments** (last ${recent.length})\n\n`;

        for (const p of recent.reverse()) {
            const date = new Date(p.timestamp);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            const target = p.vendor || `${p.address.slice(0, 8)}...`;
            msg += `• ${dateStr} — **${p.amount} USDC** → ${target}\n`;
        }

        this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    /**
     * Show monthly breakdown
     */
    showMonthlyBreakdown(chatId: number): void {
        const monthly = this.getMonthlySpending(chatId);

        if (monthly.length === 0) {
            this.bot.sendMessage(chatId, "📅 No monthly data yet.");
            return;
        }

        let msg = "📅 **Monthly Spending**\n\n";
        for (const m of monthly) {
            msg += `• **${m.month}** → ${m.total} USDC\n`;
        }

        this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }
}
