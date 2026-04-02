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

export class ScheduleStore {
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
        const all = await this.getAll(chatId);
        all.push(schedule);
        await this.store.set(NS, String(chatId), all);
        return schedule;
    }

    async getSchedules(chatId: number): Promise<Schedule[]> {
        const all = await this.getAll(chatId);
        return all.filter(s => s.active);
    }

    async getSchedule(chatId: number, scheduleId: string): Promise<Schedule | null> {
        const all = await this.getAll(chatId);
        return all.find(s => s.id === scheduleId) ?? null;
    }

    async getDueSchedules(): Promise<Array<{ chatId: number; schedule: Schedule }>> {
        const allNs = await this.store.getAll<Schedule[]>(NS);
        const now = Date.now();
        const due: Array<{ chatId: number; schedule: Schedule }> = [];

        for (const [chatIdStr, schedules] of Object.entries(allNs)) {
            for (const s of schedules) {
                if (s.active && !s.awaitingAction && s.nextExecution <= now) {
                    due.push({ chatId: parseInt(chatIdStr, 10), schedule: s });
                }
            }
        }
        return due;
    }

    async markNotified(chatId: number, scheduleId: string): Promise<void> {
        const all = await this.getAll(chatId);
        const s = all.find(x => x.id === scheduleId);
        if (s) { s.awaitingAction = true; await this.store.set(NS, String(chatId), all); }
    }

    async markExecuted(chatId: number, scheduleId: string): Promise<void> {
        const all = await this.getAll(chatId);
        const s = all.find(x => x.id === scheduleId);
        if (!s) return;

        s.awaitingAction = false;
        const next = advanceSchedule(new Date(s.nextExecution), s.frequency);
        if (next) {
            s.nextExecution = next.getTime();
        } else {
            s.active = false;
        }
        await this.store.set(NS, String(chatId), all);
    }

    async cancelSchedule(chatId: number, scheduleId: string): Promise<boolean> {
        const all = await this.getAll(chatId);
        const s = all.find(x => x.id === scheduleId && x.active);
        if (!s) return false;
        s.active = false;
        await this.store.set(NS, String(chatId), all);
        return true;
    }

    async cancelAllSchedules(chatId: number): Promise<number> {
        const all = await this.getAll(chatId);
        let count = 0;
        for (const s of all) { if (s.active) { s.active = false; count++; } }
        await this.store.set(NS, String(chatId), all);
        return count;
    }

    private async getAll(chatId: number): Promise<Schedule[]> {
        return (await this.store.get<Schedule[]>(NS, String(chatId))) ?? [];
    }
}
