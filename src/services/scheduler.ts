import { logger } from "../utils/logger";
import type { ScheduleStore } from "../store/schedules";
import type { PaymentEngine } from "../engines/payment";
import type { Sender } from "../core/sender";

export class SchedulerService {
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private schedules: ScheduleStore,
        private paymentEngine: PaymentEngine,
        private sender: Sender,
        private intervalMs: number = 10_000,
    ) {}

    start(): void {
        if (this.timer) return;
        logger.info(null, "[Scheduler] Started", { intervalMs: this.intervalMs });

        this.timer = setInterval(() => this.tick().catch(err =>
            logger.error(null, "[Scheduler] Tick error", { error: err.message })
        ), this.intervalMs);

        // Run immediately too
        this.tick().catch(err => logger.error(null, "[Scheduler] Initial tick error", { error: err.message }));
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info(null, "[Scheduler] Stopped");
        }
    }

    private async tick(): Promise<void> {
        const due = await this.schedules.getDueSchedules();
        if (due.length === 0) return;

        for (const { chatId, schedule } of due) {
            try {
                await this.schedules.markNotified(chatId, schedule.id);

                // Auto-execute the payment
                await this.paymentEngine.prepare(
                    chatId,
                    schedule.address,
                    schedule.amount,
                    schedule.token,
                    `Scheduled: ${schedule.vendor}`,
                    { type: "schedule", scheduleId: schedule.id },
                );

                // Mark executed (advances next execution or deactivates)
                await this.schedules.markExecuted(chatId, schedule.id);

                logger.info(chatId, "[Scheduler] Executed schedule", {
                    scheduleId: schedule.id,
                    vendor: schedule.vendor,
                    amount: schedule.amount,
                });
            } catch (err: any) {
                logger.error(chatId, "[Scheduler] Failed to execute schedule", {
                    scheduleId: schedule.id,
                    error: err.message,
                });
                // Reset awaiting so it can retry next tick
                await this.schedules.markNotified(chatId, schedule.id).catch(() => {});
            }
        }
    }
}
