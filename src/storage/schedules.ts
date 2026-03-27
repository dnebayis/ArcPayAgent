import { nanoid } from "nanoid";
import { loadStore, saveStore } from "./persistence";

const SCHEDULES_FILE = "schedules.json";

export type ScheduleFrequency = "once" | "weekly" | "monthly";

export interface Schedule {
    id: string;
    vendor: string;
    address: string;
    amount: number;
    nextExecution: number;
    frequency: ScheduleFrequency;
    active: boolean;
    createdAt: number;
    awaitingAction?: boolean;
    notificationSentAt?: number | null;
    lastExecutionAt?: number | null;
    token?: "USDC" | "EURC";
}

export interface UserSchedules {
    schedules: Schedule[];
}

export class ScheduleStore {
    private store: Record<string, UserSchedules>;

    constructor() {
        this.store = loadStore<Record<string, UserSchedules>>(SCHEDULES_FILE);
    }

    private persist(): void {
        saveStore(SCHEDULES_FILE, this.store);
    }

    createSchedule(
        chatId: number,
        vendor: string,
        address: string,
        amount: number,
        nextExecution: number,
        frequency: ScheduleFrequency = "once",
        token?: "USDC" | "EURC"
    ): Schedule {
        const id = chatId.toString();
        if (!this.store[id]) {
            this.store[id] = { schedules: [] };
        }

        const schedule: Schedule = {
            id: nanoid(8),
            vendor,
            address,
            amount,
            nextExecution,
            frequency,
            active: true,
            createdAt: Date.now(),
            awaitingAction: false,
            notificationSentAt: null,
            lastExecutionAt: null,
            token: token ?? "USDC"
        };

        this.store[id].schedules.push(schedule);
        this.persist();
        return schedule;
    }

    getSchedules(chatId: number): Schedule[] {
        const id = chatId.toString();
        return this.store[id]?.schedules?.filter(s => s.active) || [];
    }

    getScheduleById(chatId: number, scheduleId: string): Schedule | null {
        const id = chatId.toString();
        return this.store[id]?.schedules?.find(s => s.id === scheduleId && s.active) || null;
    }

    /**
     * Get all due schedules across all users
     */
    getDueSchedules(): { chatId: number; schedule: Schedule }[] {
        const now = Date.now();
        const due: { chatId: number; schedule: Schedule }[] = [];

        for (const [chatIdStr, userData] of Object.entries(this.store)) {
            for (const schedule of userData.schedules) {
                if (schedule.active && schedule.nextExecution <= now) {
                    if (schedule.awaitingAction) {
                        continue;
                    }
                    due.push({ chatId: parseInt(chatIdStr), schedule });
                }
            }
        }

        return due;
    }

    /**
     * After execution: advance recurring or deactivate one-time
     */
    markExecuted(chatId: number, scheduleId: string): void {
        const id = chatId.toString();
        const schedule = this.store[id]?.schedules?.find(s => s.id === scheduleId);
        if (!schedule) return;

        if (schedule.frequency === "once") {
            schedule.active = false;
        } else if (schedule.frequency === "weekly") {
            schedule.nextExecution += 7 * 24 * 60 * 60 * 1000;
        } else if (schedule.frequency === "monthly") {
            const next = new Date(schedule.nextExecution);
            next.setMonth(next.getMonth() + 1);
            schedule.nextExecution = next.getTime();
        }

        schedule.awaitingAction = false;
        schedule.notificationSentAt = null;
        schedule.lastExecutionAt = Date.now();

        this.persist();
    }

    markNotified(chatId: number, scheduleId: string): void {
        const id = chatId.toString();
        const schedule = this.store[id]?.schedules?.find(s => s.id === scheduleId);
        if (!schedule) return;
        schedule.awaitingAction = true;
        schedule.notificationSentAt = Date.now();
        this.persist();
    }

    cancelSchedule(chatId: number, scheduleId: string): boolean {
        const id = chatId.toString();
        const schedule = this.store[id]?.schedules?.find(s => s.id === scheduleId && s.active);
        if (!schedule) return false;
        schedule.active = false;
        schedule.awaitingAction = false;
        schedule.notificationSentAt = null;
        this.persist();
        return true;
    }

    cancelAllSchedules(chatId: number): number {
        const id = chatId.toString();
        if (!this.store[id]) return 0;
        const active = this.store[id].schedules.filter(s => s.active);
        active.forEach(s => s.active = false);
        this.persist();
        return active.length;
    }
}
