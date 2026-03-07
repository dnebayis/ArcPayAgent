import TelegramBot from "node-telegram-bot-api";
import { ScheduleStore } from "../storage/schedules";
import { PaymentEngine } from "../engines/paymentEngine";
import { UserPreferencesStore } from "../storage/userPreferences";
import { formatUserDateTime } from "../utils/userDateTime";

export class SchedulerService {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private bot: TelegramBot,
        private scheduleStore: ScheduleStore,
        private paymentEngine: PaymentEngine,
        private userPreferencesStore: UserPreferencesStore
    ) { }

    /**
     * Start the scheduler — checks every 10 seconds for due payments
     */
    start(): void {
        console.log("[Scheduler] Started — checking every 10s");
        this.timer = setInterval(() => this.tick(), 10 * 1000);
        // Run immediately on start
        this.tick();
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log("[Scheduler] Stopped");
        }
    }

    /**
     * Check for due schedules and notify users
     */
    private tick(): void {
        const due = this.scheduleStore.getDueSchedules();

        if (due.length > 0) {
            console.log(`[Scheduler] Found ${due.length} due schedule(s)`);
        }

        for (const { chatId, schedule } of due) {
            console.log(`[Scheduler] Due: ${schedule.amount} USDC → ${schedule.vendor} for chatId=${chatId}`);

            const freqLabel = schedule.frequency === "once" ? "" : ` (${schedule.frequency})`;
            const preferences = this.userPreferencesStore.getPreferences(chatId);
            const scheduledFor = formatUserDateTime(schedule.nextExecution, preferences);

            this.bot.sendMessage(
                chatId,
                `⏰ **Scheduled payment ready**${freqLabel}\n\n${schedule.amount} USDC → **${schedule.vendor}**\nScheduled for: ${scheduledFor}`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Send now", callback_data: `sched_pay_${chatId}_${schedule.id}` },
                                { text: "⏭️ Skip", callback_data: `sched_skip_${chatId}_${schedule.id}` },
                                { text: "❌ Cancel", callback_data: `sched_cancel_${chatId}_${schedule.id}` }
                            ]
                        ]
                    }
                }
            );

            this.scheduleStore.markNotified(chatId, schedule.id);
        }
    }
}
