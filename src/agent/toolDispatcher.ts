import TelegramBot from "node-telegram-bot-api";
import { ethers } from "ethers";
import { safeSend } from "../utils/telegramSend";
import { PaymentEngine } from "../engines/paymentEngine";
import { AnalyticsEngine } from "../engines/analyticsEngine";
import { PaymentRequestEngine } from "../engines/paymentRequestEngine";
import { VendorStore } from "../storage/vendorStore";
import { WalletStore } from "../storage/walletStore";
import { ScheduleStore } from "../storage/schedules";
import { UserPreferencesStore } from "../storage/userPreferences";
import { WatchStore } from "../storage/watchStore";
import { AlertStore } from "../storage/alertStore";
import { InternalToolset } from "./internalTools";
import { ConversationMemory } from "./conversationMemory";
import { USDC } from "../blockchain/usdc";
import { parseScheduleDate } from "../utils/dateParser";
import { formatUserDateTime } from "../utils/userDateTime";
import { escapeTelegramMarkdown } from "../utils/telegramMarkdown";
import { ParsedIntent } from "../core/orchestrator";

interface ToolDispatcherDeps {
    bot: TelegramBot;
    paymentEngine: PaymentEngine;
    analyticsEngine: AnalyticsEngine;
    paymentRequestEngine: PaymentRequestEngine;
    vendorStore: VendorStore;
    walletStore: WalletStore;
    scheduleStore: ScheduleStore;
    userPreferencesStore: UserPreferencesStore;
    watchStore: WatchStore;
    alertStore: AlertStore;
    internalTools: InternalToolset;
    memory: ConversationMemory;
    usdc: USDC;
    eurc: USDC;
}

export class ToolDispatcher {
    constructor(private deps: ToolDispatcherDeps) { }

    private async reply(chatId: number, msg: string, opts?: object): Promise<void> {
        await safeSend(this.deps.bot, chatId, msg, opts as TelegramBot.SendMessageOptions);
        this.deps.memory.addBotMessage(chatId, msg);
    }

    async execute(chatId: number, intent: ParsedIntent): Promise<string> {
        const { paymentEngine, analyticsEngine, paymentRequestEngine,
            vendorStore, walletStore, scheduleStore,
            internalTools, memory } = this.deps;

        const action = intent.action || "chat";

        switch (action) {
            // ── Payment ────────────────────────────────────────────────
            case "create_payment": {
                const beneficiary = intent.beneficiary ? String(intent.beneficiary) : null;
                const amount = intent.amount != null ? String(intent.amount) : null;
                if (!beneficiary || !amount) {
                    if (!intent.message) {
                        await this.reply(chatId, "I need a recipient and amount to prepare a payment. Example: `send 5 usdc to aws`", { parse_mode: "Markdown" });
                    }
                    return "";
                }
                const token = (intent.token === "EURC") ? "EURC" : "USDC";
                await paymentEngine.preparePayment(chatId, beneficiary, amount, intent.memo ? String(intent.memo) : "ArcPay", { origin: "byok", token });
                if (beneficiary) memory.setLastPayment(chatId, beneficiary, String(amount), token);
                memory.recordEpisodicEvent(chatId, `initiated payment: ${amount} ${token} to ${beneficiary}`);
                return `Payment card prepared for ${amount} ${token} to ${beneficiary}. Awaiting confirmation.`;
            }

            // ── Schedule ───────────────────────────────────────────────
            case "schedule_payment": {
                const beneficiary = intent.beneficiary ? String(intent.beneficiary) : null;
                const amount = intent.amount != null ? Number(intent.amount) : null;
                if (!beneficiary || !amount) {
                    if (!intent.message) {
                        await this.reply(chatId, "I need a recipient, amount, and time to schedule a payment. Example: `schedule payment 10 usdc to aws tomorrow`", { parse_mode: "Markdown" });
                    }
                    return "";
                }
                const scheduleToken = (intent.token === "EURC") ? "EURC" : "USDC";
                const frequency = (["once", "weekly", "monthly"].includes(String(intent.frequency || ""))
                    ? intent.frequency as string
                    : "once");
                await this.createSchedule(chatId, beneficiary, amount, intent);
                memory.recordEpisodicEvent(chatId, `scheduled payment: ${amount} ${scheduleToken} to ${beneficiary} (${frequency})`);
                return `Schedule created for ${amount} ${scheduleToken} to ${beneficiary}.`;
            }

            case "cancel_schedule": {
                const scheduleId = intent.name ? String(intent.name) : null;
                if (!scheduleId) {
                    const schedules = scheduleStore.getSchedules(chatId);
                    if (!schedules.length) {
                        await this.reply(chatId, "No active schedules found.");
                        return "No active schedules.";
                    }
                    const list = schedules.map(s =>
                        `• \`${s.id}\` — ${s.amount} ${s.token ?? "USDC"} to ${escapeTelegramMarkdown(s.vendor)} (${s.frequency})`
                    ).join("\n");
                    await this.reply(chatId, `Which schedule would you like to cancel?\n\n${list}\n\nSay \`cancel schedule <id>\` to cancel one.`, { parse_mode: "Markdown" });
                    return "Listed schedules for selection.";
                }
                const cancelled = scheduleStore.cancelSchedule(chatId, scheduleId);
                if (cancelled) {
                    const remaining = scheduleStore.getSchedules(chatId).length;
                    const remainingNote = remaining === 0
                        ? " No more active schedules."
                        : ` ${remaining} schedule${remaining === 1 ? "" : "s"} still active.`;
                    await this.reply(chatId, `❌ Schedule \`${scheduleId}\` cancelled.${remainingNote}`, { parse_mode: "Markdown" });
                } else {
                    await this.reply(chatId, `Schedule \`${scheduleId}\` not found.`, { parse_mode: "Markdown" });
                }
                return cancelled ? "Schedule cancelled." : "Schedule not found.";
            }

            case "cancel_all_schedules": {
                const schedules = scheduleStore.getSchedules(chatId);
                if (!schedules.length) {
                    await this.reply(chatId, "No active schedules to cancel.");
                    return "No active schedules.";
                }
                for (const s of schedules) {
                    scheduleStore.cancelSchedule(chatId, s.id);
                }
                await this.reply(chatId, `❌ All ${schedules.length} schedule${schedules.length === 1 ? "" : "s"} cancelled.`);
                return "All schedules cancelled.";
            }

            case "list_schedules": {
                const result = await internalTools.execute(chatId, "schedule_summary");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return "Schedules listed.";
            }

            // ── Vendors ────────────────────────────────────────────────
            case "save_vendor": {
                const name = intent.name ? String(intent.name) : null;
                const address = intent.address ? String(intent.address) : null;
                if (!name || !address) {
                    if (!intent.message) {
                        await this.reply(chatId, "I need a vendor name and address. Example: `save vendor aws 0x...`", { parse_mode: "Markdown" });
                    }
                    return "";
                }
                if (!ethers.isAddress(address)) {
                    await this.reply(chatId, "That doesn't look like a valid EVM address. Please provide a full `0x...` address.", { parse_mode: "Markdown" });
                    return "";
                }
                await vendorStore.saveVendor(chatId, name, address);
                memory.setLastVendor(chatId, name, address);
                memory.recordEpisodicEvent(chatId, `saved vendor: ${name} (${address})`);
                await this.reply(chatId, `✅ Vendor **${escapeTelegramMarkdown(name)}** saved with address \`${address}\`.`, { parse_mode: "Markdown" });
                return `Vendor ${name} saved.`;
            }

            case "list_vendors": {
                const vendors = vendorStore.getVendorsWithStats(chatId);
                if (!vendors || Object.keys(vendors).length === 0) {
                    await this.reply(chatId, "No vendors saved yet. Use `save vendor <name> <0x...>` to add one.", { parse_mode: "Markdown" });
                    return "Vendors listed.";
                }
                let msg = "📋 **Saved Vendors**\n\n";
                for (const [name, data] of Object.entries(vendors)) {
                    const display = data.displayName || name;
                    const stats = data.totalPaid > 0 ? ` — ${data.totalPaid} USDC paid` : "";
                    msg += `• **${escapeTelegramMarkdown(display)}** \`${data.address.slice(0, 10)}...\`${stats}\n`;
                }
                await this.reply(chatId, msg, { parse_mode: "Markdown" });
                return "Vendors listed.";
            }

            case "remove_vendor": {
                const name = intent.name ? String(intent.name) : null;
                if (!name) {
                    await this.reply(chatId, "Which vendor would you like to remove?");
                    return "";
                }
                const removed = await vendorStore.removeVendor(chatId, name);
                if (removed) memory.recordEpisodicEvent(chatId, `removed vendor: ${name}`);
                await this.reply(chatId, removed
                    ? `✅ Vendor **${escapeTelegramMarkdown(name)}** removed.`
                    : `Vendor **${escapeTelegramMarkdown(name)}** not found.`,
                    { parse_mode: "Markdown" }
                );
                return removed ? "Vendor removed." : "Vendor not found.";
            }

            case "remove_all_vendors": {
                const { vendorStore: vs } = this.deps;
                const count = vs.removeAllVendors(chatId);
                if (count === 0) {
                    await this.reply(chatId, "No vendors to remove.");
                } else {
                    await this.reply(chatId, "✅ All vendors removed.");
                }
                return "All vendors removed.";
            }

            case "vendor_detail": {
                const name = intent.name ? String(intent.name) : null;
                const result = await internalTools.execute(chatId, "vendor_lookup", name ? { name } : {});
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                if (name) memory.setLastVendor(chatId, name);
                return result.summary;
            }

            case "top_vendors": {
                const top = vendorStore.getTopVendors(chatId, 10);
                if (!top.length) {
                    await this.reply(chatId, "No vendor spending data yet.");
                    return "Top vendors shown.";
                }
                let msg = "🏆 **Top Vendors by Spending**\n\n";
                top.forEach((v, i) => {
                    const display = v.data.displayName || v.name;
                    msg += `${i + 1}. **${escapeTelegramMarkdown(display)}** — ${v.data.totalPaid} USDC\n`;
                });
                await this.reply(chatId, msg, { parse_mode: "Markdown" });
                return "Top vendors shown.";
            }

            // ── Wallet ─────────────────────────────────────────────────
            case "create_wallet": {
                if (walletStore.hasWallet(chatId)) {
                    const address = walletStore.getWalletAddress(chatId);
                    await this.reply(chatId, `You already have a wallet: \`${address}\``, { parse_mode: "Markdown" });
                    return "Wallet creation attempted.";
                }
                try {
                    await this.reply(chatId, "Creating your wallet on Arc Testnet...");
                    const address = await walletStore.createWallet(chatId);
                    memory.recordEpisodicEvent(chatId, `created wallet`);
                    await this.reply(chatId,
                        `✅ **Wallet Created**\n\nAddress: \`${address}\`\n\nYou can now receive and send USDC on Arc Testnet.`,
                        { parse_mode: "Markdown" }
                    );
                } catch (error: unknown) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    await this.reply(chatId, `❌ Failed to create wallet: ${errMsg}`);
                }
                return "Wallet creation attempted.";
            }

            case "show_wallet": {
                const result = await internalTools.execute(chatId, "wallet_summary");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            case "export_wallet": {
                await this.reply(chatId,
                    "This wallet is managed by Circle's MPC infrastructure — private keys are never exposed, not even to ArcPay Agent. This is by design: Circle's multi-party computation splits and distributes key material so no single party holds the full key.\n\nWhat you *can* do:\n• View your wallet address and balance with `show wallet`\n• Transfer your USDC to any external address you control"
                );
                return "Wallet export info shown.";
            }

            case "wallet_intelligence": {
                const result = await internalTools.execute(chatId, "wallet_summary");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            // ── Analytics ──────────────────────────────────────────────
            case "report": {
                await analyticsEngine.showReport(chatId, "month");
                return "Report shown.";
            }

            case "spending_by_vendor": {
                await analyticsEngine.showVendorBreakdown(chatId, "all");
                return "Vendor breakdown shown.";
            }

            case "payment_history": {
                await analyticsEngine.showHistory(chatId, 10);
                return "Payment history shown.";
            }

            case "show_recent_payments": {
                const result = await internalTools.execute(chatId, "recent_payments", { limit: 5 });
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            case "show_pending_payments": {
                const result = await internalTools.execute(chatId, "pending_payment_status");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            case "monthly_spending": {
                await analyticsEngine.showMonthlyBreakdown(chatId);
                return "Monthly breakdown shown.";
            }

            case "account_summary": {
                const result = await internalTools.execute(chatId, "account_snapshot");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            case "status": {
                const result = await internalTools.execute(chatId, "agent_operations_overview");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            // ── Payment requests ───────────────────────────────────────
            case "create_payment_request": {
                const amount = intent.amount != null ? Number(intent.amount) : null;
                if (!amount || amount <= 0) {
                    await this.reply(chatId, "How much USDC would you like to request?");
                    return "";
                }
                await paymentRequestEngine.createRequest(chatId, amount);
                return "Payment request created.";
            }

            // ── Agent identity ─────────────────────────────────────────
            case "agent_status": {
                const result = await internalTools.execute(chatId, "agent_registration_status");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            case "agent_identity": {
                const result = await internalTools.execute(chatId, "agent_identity");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            case "agent_validation_status": {
                const result = await internalTools.execute(chatId, "agent_validation_status");
                await this.reply(chatId, result.summary, { parse_mode: "Markdown" });
                return result.summary;
            }

            // ── Invoice ────────────────────────────────────────────────
            case "analyze_invoice": {
                if (!intent.message) {
                    await this.reply(chatId, "Please send me the invoice as a PDF or photo and I'll analyze it for you.");
                }
                return "Invoice analysis instructions shown.";
            }

            // ── Incoming payment watch ─────────────────────────────────
            case "watch_payments_enable": {
                const { watchStore, walletStore: ws, usdc, eurc } = this.deps;
                if (!ws.hasWallet(chatId)) {
                    await this.reply(chatId, "You need a wallet first. Use `create wallet` to set one up.", { parse_mode: "Markdown" });
                    return "Watch enabled.";
                }
                const addr = ws.getWalletAddress(chatId)!;
                try {
                    const [usdcBal, eurcBal] = await Promise.all([
                        usdc.balanceOf(addr),
                        eurc.balanceOf(addr)
                    ]);
                    watchStore.enable(chatId, addr, usdcBal.toString(), eurcBal.toString());
                    await this.reply(chatId, "✅ **Incoming payment notifications enabled.**\n\nI'll notify you whenever USDC or EURC arrives in your wallet.", { parse_mode: "Markdown" });
                } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    await this.reply(chatId, `❌ Failed to enable watch: ${errMsg}`);
                }
                return "Watch enabled.";
            }

            case "watch_payments_disable": {
                const { watchStore } = this.deps;
                const disabled = watchStore.disable(chatId);
                await this.reply(chatId, disabled
                    ? "🔕 Incoming payment notifications disabled."
                    : "Incoming payment notifications were not enabled."
                );
                return "Watch disabled.";
            }

            case "watch_payments_status": {
                const { watchStore } = this.deps;
                const enabled = watchStore.isEnabled(chatId);
                await this.reply(chatId, enabled
                    ? "✅ Incoming payment notifications are **enabled**. I'll notify you when USDC or EURC arrives."
                    : "🔕 Incoming payment notifications are **disabled**. Say `watch my wallet` to enable them.",
                    { parse_mode: "Markdown" }
                );
                return "Watch status shown.";
            }

            // ── Price alerts ───────────────────────────────────────────
            case "set_price_alert": {
                const { alertStore } = this.deps;
                const symbol = intent.symbol ? String(intent.symbol).toUpperCase() : null;
                const alertPrice = intent.alert_price != null ? Number(intent.alert_price) : null;
                const rawDir = intent.alert_direction ? String(intent.alert_direction) : null;
                const direction: "above" | "below" | null = (rawDir === "above" || rawDir === "below") ? rawDir : null;

                if (!symbol || !alertPrice || !direction) {
                    await this.reply(chatId, "I need a symbol, target price, and direction. Example: `alert me when BTC goes above $100000`", { parse_mode: "Markdown" });
                    return "";
                }

                const alert = alertStore.createAlert(chatId, symbol, alertPrice, direction);
                memory.recordEpisodicEvent(chatId, `set price alert: ${symbol} ${direction} $${alertPrice}`);
                const dirWord = direction === "above" ? "rises above" : "drops below";
                await this.reply(chatId,
                    `🔔 **Price alert set**\n\nI'll notify you when **${symbol}** ${dirWord} $${alertPrice.toLocaleString("en-US")}.\nAlert ID: \`${alert.id}\``,
                    { parse_mode: "Markdown" }
                );
                return `Price alert set for ${symbol}.`;
            }

            case "list_price_alerts": {
                const { alertStore } = this.deps;
                const alerts = alertStore.getAlerts(chatId);
                if (!alerts.length) {
                    await this.reply(chatId, "No active price alerts. Say `alert me when BTC hits $X` to set one.", { parse_mode: "Markdown" });
                    return "Price alerts listed.";
                }
                let msg = "🔔 **Active Price Alerts**\n\n";
                for (const a of alerts) {
                    const dirWord = a.direction === "above" ? "↑ above" : "↓ below";
                    msg += `• \`${a.id}\` **${a.symbol}** ${dirWord} $${a.targetPrice.toLocaleString("en-US")}\n`;
                }
                await this.reply(chatId, msg, { parse_mode: "Markdown" });
                return "Price alerts listed.";
            }

            case "remove_price_alert": {
                const { alertStore } = this.deps;
                const alertId = intent.name ? String(intent.name) : null;
                if (!alertId) {
                    const alerts = alertStore.getAlerts(chatId);
                    if (!alerts.length) {
                        await this.reply(chatId, "No active price alerts to remove.");
                        return "Alert not found.";
                    }
                    let msg = "Which alert would you like to remove?\n\n";
                    for (const a of alerts) {
                        const dirWord = a.direction === "above" ? "↑ above" : "↓ below";
                        msg += `• \`${a.id}\` ${a.symbol} ${dirWord} $${a.targetPrice.toLocaleString("en-US")}\n`;
                    }
                    msg += "\nSay `remove alert <id>` to remove one.";
                    await this.reply(chatId, msg, { parse_mode: "Markdown" });
                    return "Alert not found.";
                }
                const removed = alertStore.removeAlert(chatId, alertId);
                await this.reply(chatId, removed
                    ? `✅ Price alert \`${alertId}\` removed.`
                    : `Alert \`${alertId}\` not found.`,
                    { parse_mode: "Markdown" }
                );
                return removed ? "Alert removed." : "Alert not found.";
            }

            case "remove_all_price_alerts": {
                const { alertStore } = this.deps;
                const count = alertStore.removeAllAlerts(chatId);
                await this.reply(chatId, count > 0
                    ? `✅ All ${count} price alert${count === 1 ? "" : "s"} removed.`
                    : "No active price alerts to remove."
                );
                return "All alerts removed.";
            }

            // ── Chat (LLM produced message only, no action needed) ─────
            case "chat": {
                // Message already sent by orchestrator
                return "";
            }

            default: {
                console.warn(`[ToolDispatcher] Unknown action: ${action}`);
                // No additional message - orchestrator already sent intent.message
                return "";
            }
        }
    }

    private async createSchedule(
        chatId: number,
        beneficiary: string,
        amount: number,
        intent: ParsedIntent
    ): Promise<void> {
        const { vendorStore, scheduleStore, userPreferencesStore, memory } = this.deps;

        const isDirectAddress = ethers.isAddress(beneficiary);
        const scheduleAddress = isDirectAddress ? beneficiary : vendorStore.getVendor(chatId, beneficiary);

        if (!scheduleAddress) {
            await this.reply(chatId, `❌ Vendor **${escapeTelegramMarkdown(beneficiary)}** not found. Save it first with \`save vendor ${beneficiary} 0x...\`, or use a full wallet address.`, { parse_mode: "Markdown" });
            return;
        }

        const timeInput = intent.schedule_time ? String(intent.schedule_time) : "";
        let nextExecution = parseScheduleDate(timeInput);

        if (!nextExecution) {
            nextExecution = parseScheduleDate("tomorrow")!;
        }

        const frequency = (["once", "weekly", "monthly"].includes(String(intent.frequency || ""))
            ? intent.frequency as "once" | "weekly" | "monthly"
            : "once");

        const scheduleToken = (intent.token === "EURC") ? "EURC" : "USDC";
        const schedule = scheduleStore.createSchedule(chatId, beneficiary, scheduleAddress, amount, nextExecution, frequency, scheduleToken);
        memory.setLastSchedule(chatId, schedule.vendor, schedule.amount.toString(), schedule.nextExecution, schedule.id);

        const preferences = userPreferencesStore.getPreferences(chatId);

        const msg = `✅ **Scheduled payment created**\n\nAmount: ${schedule.amount} ${schedule.token ?? "USDC"}\nRecipient: **${escapeTelegramMarkdown(schedule.vendor)}**\nExecution: ${formatUserDateTime(schedule.nextExecution, preferences)}\nFrequency: ${schedule.frequency}\nID: \`${schedule.id}\``;
        await this.reply(chatId, msg, { parse_mode: "Markdown" });
    }
}
