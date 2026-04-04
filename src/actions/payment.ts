import { registerAction } from "./registry";
import type { PaymentEngine } from "../engines/payment";
import type { ScheduleStore } from "../store/schedules";
import type { VendorStore } from "../store/vendors";
import type { WalletStore } from "../store/wallets";
import type { ConversationMemory } from "../memory/conversation";
import { parseScheduleTime, parseFrequency, advanceSchedule, type Frequency } from "../utils/dates";

export interface PaymentActionDeps {
    paymentEngine: PaymentEngine;
    schedules: ScheduleStore;
    vendors: VendorStore;
    wallets: WalletStore;
    memory: ConversationMemory;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerPaymentActions(deps: PaymentActionDeps): void {
    registerAction("create_payment", async (chatId, params) => {
        const { beneficiary, amount, token, memo } = params;
        if (!amount || isNaN(Number(amount))) {
            deps.memory.setFlowState(chatId, {
                status: "awaiting_amount",
                beneficiary: beneficiary || undefined,
                token: token || "USDC",
            });
            await deps.send(chatId, "How much would you like to send?");
            return;
        }
        await deps.paymentEngine.prepare(
            chatId,
            beneficiary,
            Number(amount),
            token || "USDC",
            memo || null,
        );
    });

    registerAction("schedule_payment", async (chatId, params) => {
        const { beneficiary, amount, token, frequency, schedule_time } = params;

        if (!beneficiary || !amount) {
            await deps.send(chatId, "Please provide a beneficiary and amount for the schedule.");
            return;
        }

        // Resolve vendor
        let address = beneficiary;
        let vendorName = beneficiary;
        if (!beneficiary.startsWith("0x")) {
            const found = await deps.vendors.findVendor(chatId, beneficiary);
            if (!found) {
                await deps.send(chatId, `Vendor "${beneficiary}" not found. Please save the vendor first.`);
                return;
            }
            address = found.data.address;
            vendorName = found.data.displayName;
        }

        const freq = parseFrequency(frequency || "once");

        // Parse schedule_time; for recurring schedules default to tomorrow at 9 AM
        let nextExecution: number;
        if (schedule_time) {
            nextExecution = parseScheduleTime(schedule_time)?.getTime() ?? defaultNextExecution(freq);
        } else {
            nextExecution = defaultNextExecution(freq);
        }

        // Apply user timezone offset (server runs in UTC, user means local time)
        const tzOffset = deps.memory.getTimezone(chatId);
        if (tzOffset !== 0) {
            nextExecution -= tzOffset * 3_600_000;
        }

        // For recurring schedules, if the first execution is within the next hour,
        // push to the next occurrence. A weekly schedule shouldn't fire minutes after creation.
        if (freq !== "once" && nextExecution - Date.now() < 3_600_000) {
            const next = advanceSchedule(new Date(nextExecution), freq);
            if (next) nextExecution = next.getTime();
        }

        const schedule = await deps.schedules.createSchedule(chatId, {
            vendor: vendorName,
            address,
            amount: Number(amount),
            token: token || "USDC",
            frequency: freq,
            nextExecution,
        });

        deps.memory.setLastSchedule(chatId, schedule.id, vendorName, Number(amount));

        const freqLabel = freq === "once" ? "one-time" : freq;
        // Display in user's local time
        const displayTime = new Date(nextExecution + tzOffset * 3_600_000);
        const timeLabel = displayTime.toLocaleString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            timeZone: "UTC",
        });
        await deps.send(chatId, `Schedule created: ${Number(amount).toFixed(2)} ${token || "USDC"} to ${vendorName} (${freqLabel}, next: ${timeLabel})`);
    });

    registerAction("cancel_schedule", async (chatId, params) => {
        const { schedule_id } = params;
        if (!schedule_id) {
            await deps.send(chatId, "Please provide a schedule ID. Use list_schedules to see your active schedules.");
            return;
        }
        const cancelled = await deps.schedules.cancelSchedule(chatId, schedule_id);
        if (cancelled) {
            await deps.send(chatId, `Schedule ${schedule_id} cancelled.`);
        } else {
            await deps.send(chatId, `Schedule ${schedule_id} not found or already cancelled.`);
        }
    });

    registerAction("cancel_all_schedules", async (chatId) => {
        const count = await deps.schedules.cancelAllSchedules(chatId);
        await deps.send(chatId, count > 0
            ? `Cancelled ${count} schedule(s).`
            : "No active schedules to cancel.");
    });

    registerAction("list_schedules", async (chatId) => {
        const schedules = await deps.schedules.getSchedules(chatId);
        if (schedules.length === 0) {
            await deps.send(chatId, "No active schedules.");
            return;
        }

        // Display in user's local time
        const tz = deps.memory.getTimezone(chatId);
        const fmt = (ts: number) => new Date(ts + tz * 3_600_000).toLocaleString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            timeZone: "UTC",
        });

        let text = "Active Schedules\n\n";
        for (const s of schedules) {
            text += `ID: ${s.id}\n`;
            text += `  ${s.amount.toFixed(2)} ${s.token} to ${s.vendor} (${s.frequency})\n`;

            if (s.frequency === "once") {
                text += `  Date: ${fmt(s.nextExecution)}\n`;
            } else {
                // Show next 4 upcoming dates
                const upcoming: number[] = [];
                let d = new Date(s.nextExecution);
                for (let i = 0; i < 4; i++) {
                    upcoming.push(d.getTime());
                    const next = advanceSchedule(d, s.frequency as Frequency);
                    if (!next) break;
                    d = next;
                }
                text += `  Upcoming:\n`;
                for (const ts of upcoming) {
                    text += `    ${fmt(ts)}\n`;
                }
            }
            text += "\n";
        }
        await deps.send(chatId, text);
    });
}

/**
 * Sensible default next execution for recurring schedules when no time is given.
 * - once    → 5 minutes from now
 * - daily   → tomorrow at 09:00
 * - weekly  → next week, same weekday, at 09:00
 * - monthly → same day next month at 09:00
 */
function defaultNextExecution(freq: Frequency): number {
    const d = new Date();
    if (freq === "once") return Date.now() + 5 * 60_000;
    d.setHours(9, 0, 0, 0);
    if (freq === "daily") {
        d.setDate(d.getDate() + 1);
    } else if (freq === "weekly") {
        d.setDate(d.getDate() + 7);
    } else if (freq === "monthly") {
        d.setMonth(d.getMonth() + 1);
    }
    return d.getTime();
}
