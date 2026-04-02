import type { PaymentLogStore, PaymentLog } from "../store/payments";
import type { VendorStore } from "../store/vendors";
import type { ScheduleStore } from "../store/schedules";
import type { WalletStore } from "../store/wallets";
import type { TokenOps } from "../chain/tokens";
import { formatAmount as fmtBigint } from "../utils/format";

export interface AnalyticsEngineDeps {
    paymentLog: PaymentLogStore;
    vendors: VendorStore;
    schedules: ScheduleStore;
    wallets: WalletStore;
    tokens: TokenOps;
    send: (chatId: number, text: string) => Promise<void>;
}

export class AnalyticsEngine {
    private deps: AnalyticsEngineDeps;

    constructor(deps: AnalyticsEngineDeps) {
        this.deps = deps;
    }

    async report(chatId: number, period: "week" | "month" | "all" = "all"): Promise<void> {
        const payments = await this.getPaymentsForPeriod(chatId, period);

        if (payments.length === 0) {
            await this.deps.send(chatId, `No payments found for the selected period.`);
            return;
        }

        const total = payments.reduce((s, p) => s + p.amount, 0);
        const byVendor = this.groupByVendor(payments);
        const topVendors = Object.entries(byVendor)
            .sort(([, a], [, b]) => b.total - a.total)
            .slice(0, 5);

        let text = `Spending Report (${period})\n\n`;
        text += `Total: $${total.toFixed(2)}\n`;
        text += `Transactions: ${payments.length}\n\n`;
        text += `Top vendors:\n`;
        for (const [vendor, data] of topVendors) {
            text += `  ${vendor}: $${data.total.toFixed(2)} (${data.count} payments)\n`;
        }

        await this.deps.send(chatId, text);
    }

    async spendingByVendor(chatId: number): Promise<void> {
        const payments = await this.deps.paymentLog.getPayments(chatId);
        if (payments.length === 0) {
            await this.deps.send(chatId, "No payment history found.");
            return;
        }

        const byVendor = this.groupByVendor(payments);
        const sorted = Object.entries(byVendor).sort(([, a], [, b]) => b.total - a.total);

        let text = "Spending by Vendor\n\n";
        for (const [vendor, data] of sorted) {
            text += `${vendor}: $${data.total.toFixed(2)} (${data.count} payments)\n`;
        }

        await this.deps.send(chatId, text);
    }

    async monthlySpending(chatId: number): Promise<void> {
        const payments = await this.deps.paymentLog.getPayments(chatId);
        if (payments.length === 0) {
            await this.deps.send(chatId, "No payment history found.");
            return;
        }

        const byMonth = new Map<string, { total: number; count: number }>();
        for (const p of payments) {
            const d = new Date(p.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            const entry = byMonth.get(key) || { total: 0, count: 0 };
            entry.total += p.amount;
            entry.count++;
            byMonth.set(key, entry);
        }

        const sorted = [...byMonth.entries()].sort(([a], [b]) => b.localeCompare(a));

        let text = "Monthly Spending\n\n";
        for (const [month, data] of sorted) {
            text += `${month}: $${data.total.toFixed(2)} (${data.count} payments)\n`;
        }

        await this.deps.send(chatId, text);
    }

    async recentPayments(chatId: number): Promise<void> {
        const payments = await this.deps.paymentLog.getRecentPayments(chatId, 10);
        if (payments.length === 0) {
            await this.deps.send(chatId, "No recent payments.");
            return;
        }

        let text = "Recent Payments\n\n";
        for (const p of payments) {
            const date = new Date(p.timestamp).toLocaleDateString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            });
            text += `${date} — ${p.amount.toFixed(2)} ${p.token} to ${p.vendor}\n`;
        }

        await this.deps.send(chatId, text);
    }

    async accountSummary(chatId: number): Promise<void> {
        const wallet = await this.deps.wallets.getWallet(chatId);
        const parts: string[] = ["Account Summary\n"];

        if (wallet) {
            parts.push(`Wallet: ${wallet.address}`);
            try {
                const usdcBal = await this.deps.tokens.balanceOf("USDC", wallet.address);
                const eurcBal = await this.deps.tokens.balanceOf("EURC", wallet.address);
                parts.push(`USDC: ${fmtBigint(usdcBal)}`);
                parts.push(`EURC: ${fmtBigint(eurcBal)}`);
            } catch {
                parts.push("Balance: unavailable");
            }
        } else {
            parts.push("No wallet configured.");
        }

        const vendors = await this.deps.vendors.listVendors(chatId);
        parts.push(`\nVendors: ${Object.keys(vendors).length}`);

        const schedules = await this.deps.schedules.getSchedules(chatId);
        parts.push(`Active schedules: ${schedules.length}`);

        const recent = await this.deps.paymentLog.getRecentPayments(chatId, 3);
        if (recent.length > 0) {
            parts.push("\nLast 3 payments:");
            for (const p of recent) {
                parts.push(`  ${p.amount.toFixed(2)} ${p.token} to ${p.vendor}`);
            }
        }

        await this.deps.send(chatId, parts.join("\n"));
    }

    async status(chatId: number): Promise<void> {
        const wallet = await this.deps.wallets.getWallet(chatId);
        const parts: string[] = [];

        if (wallet) {
            parts.push(`Wallet: ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`);
            try {
                const usdcBal = await this.deps.tokens.balanceOf("USDC", wallet.address);
                parts.push(`USDC: ${fmtBigint(usdcBal)}`);
            } catch {
                parts.push("Balance: unavailable");
            }
        } else {
            parts.push("No wallet.");
        }

        const schedules = await this.deps.schedules.getSchedules(chatId);
        parts.push(`Active schedules: ${schedules.length}`);

        await this.deps.send(chatId, parts.join("\n"));
    }

    async topVendors(chatId: number): Promise<void> {
        const top = await this.deps.vendors.getTopVendors(chatId, 5);
        if (top.length === 0) {
            await this.deps.send(chatId, "No vendors found.");
            return;
        }

        let text = "Top Vendors\n\n";
        for (let i = 0; i < top.length; i++) {
            const v = top[i];
            text += `${i + 1}. ${v.data.displayName}: $${v.data.totalPaid.toFixed(2)} (${v.data.paymentCount} payments)\n`;
        }

        await this.deps.send(chatId, text);
    }

    private async getPaymentsForPeriod(chatId: number, period: string): Promise<PaymentLog[]> {
        if (period === "all") return this.deps.paymentLog.getPayments(chatId);

        const now = Date.now();
        const ms = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
        return this.deps.paymentLog.getPaymentsSince(chatId, now - ms);
    }

    private groupByVendor(payments: PaymentLog[]): Record<string, { total: number; count: number }> {
        const map: Record<string, { total: number; count: number }> = {};
        for (const p of payments) {
            const key = p.vendor;
            if (!map[key]) map[key] = { total: 0, count: 0 };
            map[key].total += p.amount;
            map[key].count++;
        }
        return map;
    }
}
