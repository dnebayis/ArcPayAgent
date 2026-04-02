import { registerAction } from "./registry";
import type { PaymentEngine } from "../engines/payment";
import type { ScheduleStore } from "../store/schedules";
import type { VendorStore } from "../store/vendors";
import type { WalletStore } from "../store/wallets";
import type { ConversationMemory } from "../memory/conversation";
import { parseScheduleTime, parseFrequency, type Frequency } from "../utils/dates";

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
        const nextExecution = schedule_time
            ? parseScheduleTime(schedule_time)?.getTime() || Date.now() + 60_000
            : Date.now() + 60_000;

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
        const timeLabel = new Date(nextExecution).toLocaleString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
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

        let text = "Active Schedules\n\n";
        for (const s of schedules) {
            const next = new Date(s.nextExecution).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            });
            text += `ID: ${s.id}\n  ${s.amount.toFixed(2)} ${s.token} to ${s.vendor} (${s.frequency})\n  Next: ${next}\n\n`;
        }
        await deps.send(chatId, text);
    });
}
