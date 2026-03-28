import TelegramBot from "node-telegram-bot-api";
import { PaymentLogStore, PaymentLogEntry } from "../storage/paymentLogs";
import { formatUsdcAmount } from "../utils/formatUsdcAmount";
import { escapeTelegramMarkdown } from "../utils/telegramMarkdown";
import { logger } from "../utils/logger";

export type MessageCallback = (chatId: number, msg: string) => void;

export class AnalyticsEngine {
    constructor(
        private bot: TelegramBot,
        private paymentLogs: PaymentLogStore,
        private onMessage?: MessageCallback
    ) { }

    private async send(chatId: number, msg: string, opts?: TelegramBot.SendMessageOptions): Promise<void> {
        const args: [number, string, TelegramBot.SendMessageOptions?] = opts
            ? [chatId, msg, opts]
            : [chatId, msg];
        await this.bot.sendMessage(...args).catch((firstErr: unknown) => {
            // Strip parse_mode on retry (most common cause of 400 errors on malformed markdown)
            logger.warn(null, "[AnalyticsEngine] sendMessage failed, retrying without parse_mode", {
                chatId,
                error: firstErr instanceof Error ? firstErr.message : String(firstErr),
                preview: msg.slice(0, 80),
            });
            return this.bot.sendMessage(chatId, msg);
        });
        this.onMessage?.(chatId, msg);
    }

    private getPeriodWindow(period: "all" | "month" | "week"): { since?: number; label: string } {
        const now = Date.now();

        if (period === "month") {
            return {
                since: now - 30 * 24 * 60 * 60 * 1000,
                label: "Last 30 Days"
            };
        }

        if (period === "week") {
            return {
                since: now - 7 * 24 * 60 * 60 * 1000,
                label: "Last 7 Days"
            };
        }

        return { label: "All Time" };
    }

    private getPayments(chatId: number, since?: number): PaymentLogEntry[] {
        return since
            ? this.paymentLogs.getPaymentsSince(chatId, since)
            : this.paymentLogs.getPayments(chatId);
    }

    /**
     * Total spending (all time or since a given timestamp)
     */
    getTotalSpending(chatId: number, since?: number): number {
        const payments = this.getPayments(chatId, since);
        return payments.reduce((sum, p) => sum + p.amount, 0);
    }

    /**
     * Spending grouped by vendor
     */
    getSpendingByVendor(chatId: number, since?: number): { vendor: string; total: number; count: number }[] {
        const payments = this.getPayments(chatId, since);

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
    getMonthlySpending(chatId: number): { month: string; total: number; count: number; topVendor: string | null; vendors: { vendor: string; total: number; count: number }[] }[] {
        const payments = this.paymentLogs.getPayments(chatId);
        const map: Record<string, { total: number; count: number; vendors: Record<string, { total: number; count: number }> }> = {};

        for (const p of payments) {
            const d = new Date(p.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (!map[key]) map[key] = { total: 0, count: 0, vendors: {} };
            map[key].total += p.amount;
            map[key].count += 1;
            const vKey = p.vendor || p.address.slice(0, 10);
            if (!map[key].vendors[vKey]) map[key].vendors[vKey] = { total: 0, count: 0 };
            map[key].vendors[vKey].total += p.amount;
            map[key].vendors[vKey].count += 1;
        }

        return Object.entries(map)
            .map(([month, data]) => {
                const vendors = Object.entries(data.vendors)
                    .map(([vendor, v]) => ({ vendor, total: v.total, count: v.count }))
                    .sort((a, b) => b.total - a.total);
                return {
                    month,
                    total: data.total,
                    count: data.count,
                    topVendor: vendors[0]?.vendor ?? null,
                    vendors
                };
            })
            .sort((a, b) => a.month.localeCompare(b.month));
    }

    /**
     * Show spending report to user
     */
    async showReport(chatId: number, period: "all" | "month" | "week" = "month"): Promise<void> {
        const { since, label: periodLabel } = this.getPeriodWindow(period);
        const payments = this.getPayments(chatId, since);
        const total = this.getTotalSpending(chatId, since);
        const byVendor = this.getSpendingByVendor(chatId, since);

        if (total === 0) {
            await this.send(chatId, "📊 No payments recorded yet. Start sending payments to see your analytics!");
            return;
        }

        let msg = `📊 **Spending Report — ${periodLabel}**\n\n`;
        msg += `💰 **Total spend:** ${formatUsdcAmount(total)} USDC\n`;
        msg += `🧾 **Payments:** ${payments.length}\n`;
        msg += `🏷️ **Active vendors:** ${byVendor.length}\n`;

        if (byVendor.length > 0) {
            const topVendor = byVendor[0];
            msg += `🥇 **Top vendor:** ${escapeTelegramMarkdown(topVendor.vendor)} (${formatUsdcAmount(topVendor.total)} USDC)\n`;
        }

        msg += "\n";

        if (byVendor.length > 0) {
            msg += "**Top spend categories**\n";
            for (const v of byVendor.slice(0, 5)) {
                const pct = ((v.total / total) * 100).toFixed(0);
                msg += `• **${escapeTelegramMarkdown(v.vendor)}** → ${formatUsdcAmount(v.total)} USDC (${v.count} payments, ${pct}%)\n`;
            }
        }

        await this.send(chatId, msg, { parse_mode: "Markdown" });
    }

    /**
     * Show vendor-focused spending breakdown
     */
    async showVendorBreakdown(chatId: number, period: "all" | "month" | "week" = "all"): Promise<void> {
        const { since, label: periodLabel } = this.getPeriodWindow(period);
        const total = this.getTotalSpending(chatId, since);
        const byVendor = this.getSpendingByVendor(chatId, since);

        if (byVendor.length === 0) {
            await this.send(chatId, "📊 No vendor spending recorded yet.");
            return;
        }

        let msg = `📊 **Vendor Breakdown — ${periodLabel}**\n\n`;

        byVendor.forEach((vendor, index) => {
            const pct = ((vendor.total / total) * 100).toFixed(0);
            msg += `${index + 1}. **${escapeTelegramMarkdown(vendor.vendor)}**\n`;
            msg += `   ${formatUsdcAmount(vendor.total)} USDC across ${vendor.count} payment${vendor.count === 1 ? "" : "s"} (${pct}%)\n`;
        });

        msg += `\n💰 **Total vendor spend: ${formatUsdcAmount(total)} USDC**`;

        await this.send(chatId, msg, { parse_mode: "Markdown" });
    }

    /**
     * Show recent payment history
     */
    async showHistory(chatId: number, limit: number = 10): Promise<void> {
        const recent = this.paymentLogs.getRecentPayments(chatId, limit);

        if (recent.length === 0) {
            await this.send(chatId, "📜 No payment history yet.\n\nOnce you send a payment, it will appear here.");
            return;
        }

        const total = recent.reduce((sum, payment) => sum + payment.amount, 0);
        let msg = `📜 **Payment History**\n\n`;
        msg += `Entries shown: **${recent.length}**\n`;
        msg += `Total in view: **${formatUsdcAmount(total)} USDC**\n\n`;

        for (const p of recent.reverse()) {
            const date = new Date(p.timestamp);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            const target = p.vendor ? escapeTelegramMarkdown(p.vendor) : `${p.address.slice(0, 8)}...`;
            const pToken = p.token ?? "USDC";
            msg += `• ${dateStr} — **${formatUsdcAmount(p.amount)} ${pToken}** → ${target}\n`;
        }

        msg += `\nTip: use \`account summary\` for a broader account view.`;

        await this.send(chatId, msg, { parse_mode: "Markdown" });
    }

    /**
     * Show monthly breakdown
     */
    async showMonthlyBreakdown(chatId: number): Promise<void> {
        const monthly = this.getMonthlySpending(chatId);

        if (monthly.length === 0) {
            await this.send(chatId, "📅 No monthly data yet.");
            return;
        }

        const grandTotal = monthly.reduce((sum, m) => sum + m.total, 0);
        const grandCount = monthly.reduce((sum, m) => sum + m.count, 0);

        let msg = "📅 **Monthly Spending**\n\n";
        msg += `💰 **Lifetime:** ${formatUsdcAmount(grandTotal)} USDC across ${grandCount} payment${grandCount === 1 ? "" : "s"}\n`;
        msg += `🗓️ **Active months:** ${monthly.length}\n\n`;

        // Most recent month first
        for (const m of [...monthly].reverse()) {
            msg += `**${m.month}** — ${formatUsdcAmount(m.total)} USDC · ${m.count} payment${m.count === 1 ? "" : "s"}\n`;
            for (const v of m.vendors) {
                const pct = ((v.total / m.total) * 100).toFixed(0);
                msg += `  • ${escapeTelegramMarkdown(v.vendor)}: ${formatUsdcAmount(v.total)} USDC (${v.count}x, ${pct}%)\n`;
            }
            msg += "\n";
        }

        await this.send(chatId, msg, { parse_mode: "Markdown" });
    }
}
