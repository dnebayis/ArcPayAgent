import { nanoid } from "nanoid";
import { Store } from "./base";
import { advanceSchedule, type Frequency } from "../utils/dates";

export interface Schedule {
    id: string;
    vendor: string;
    address: string;
    amount: number;
    token: "USDC" | "EURC";
    frequency: Frequency;
    nextExecution: number;
    active: boolean;
    createdAt: number;
    awaitingAction: boolean;
}

const NS = "schedules";

/** Compound row key: "{chatId}:{scheduleId}" */
const rowKey = (chatId: number, scheduleId: string) => `${chatId}:${scheduleId}`;

export class ScheduleStore {
    /**
     * Namespace : schedules
     * Key pattern: {chatId}:{scheduleId}
     * Value type : Schedule
     */
    constructor(private store: Store) {}

    async createSchedule(
        chatId: number,
        data: { vendor: string; address: string; amount: number; token: "USDC" | "EURC"; frequency: Frequency; nextExecution: number }
    ): Promise<Schedule> {
        const schedule: Schedule = {
            id: nanoid(10),
            ...data,
            active: true,
            createdAt: Date.now(),
            awaitingAction: false,
        };
        await this.store.set(NS, rowKey(chatId, schedule.id), schedule);
        return schedule;
    }

    async getSchedules(chatId: number): Promise<Schedule[]> {
        const all = await this.getAll(chatId);
        return all.filter(s => s.active);
    }

    async getSchedule(chatId: number, scheduleId: string): Promise<Schedule | null> {
        return this.store.get<Schedule>(NS, rowKey(chatId, scheduleId));
    }

    async getDueSchedules(): Promise<Array<{ chatId: number; schedule: Schedule }>> {
        const allNs = await this.store.getAll<Schedule>(NS);
        const now = Date.now();
        const due: Array<{ chatId: number; schedule: Schedule }> = [];

        for (const [key, schedule] of Object.entries(allNs)) {
            const chatId = parseInt(key.split(":")[0], 10);
            if (schedule.active && !schedule.awaitingAction && schedule.nextExecution <= now) {
                due.push({ chatId, schedule });
            }
        }
        return due;
    }

    async markNotified(chatId: number, scheduleId: string): Promise<void> {
        const s = await this.store.get<Schedule>(NS, rowKey(chatId, scheduleId));
        if (s) {
            s.awaitingAction = true;
            await this.store.set(NS, rowKey(chatId, scheduleId), s);
        }
    }

    async markExecuted(chatId: number, scheduleId: string): Promise<void> {
        const s = await this.store.get<Schedule>(NS, rowKey(chatId, scheduleId));
        if (!s) return;

        s.awaitingAction = false;
        const next = advanceSchedule(new Date(s.nextExecution), s.frequency);
        if (next) {
            s.nextExecution = next.getTime();
        } else {
            s.active = false;
        }
        await this.store.set(NS, rowKey(chatId, scheduleId), s);
    }

    async cancelSchedule(chatId: number, scheduleId: string): Promise<boolean> {
        const s = await this.store.get<Schedule>(NS, rowKey(chatId, scheduleId));
        if (!s || !s.active) return false;
        s.active = false;
        await this.store.set(NS, rowKey(chatId, scheduleId), s);
        return true;
    }

    async cancelAllSchedules(chatId: number): Promise<number> {
        const all = await this.getAll(chatId);
        let count = 0;
        for (const s of all) {
            if (s.active) {
                s.active = false;
                count++;
                await this.store.set(NS, rowKey(chatId, s.id), s);
            }
        }
        return count;
    }

    private async getAll(chatId: number): Promise<Schedule[]> {
        const prefix = `${chatId}:`;
        const raw = await this.store.getByPrefix<Schedule>(NS, prefix);
        return Object.values(raw);
    }
}
