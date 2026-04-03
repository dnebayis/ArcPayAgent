import { nanoid } from "nanoid";
import { DB } from "./db";
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

export class ScheduleStore {
    constructor(private db: DB) {}

    async createSchedule(
        chatId: number,
        data: { vendor: string; address: string; amount: number; token: "USDC" | "EURC"; frequency: Frequency; nextExecution: number }
    ): Promise<Schedule> {
        const id = nanoid(10);
        const now = Date.now();
        await this.db.run(
            `INSERT INTO schedules (id,chat_id,vendor,address,amount,token,frequency,next_execution,active,created_at,awaiting_action)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,0)`,
            [id, chatId, data.vendor, data.address, data.amount, data.token, data.frequency, data.nextExecution, now]
        );
        return { id, ...data, active: true, createdAt: now, awaitingAction: false };
    }

    async getSchedules(chatId: number): Promise<Schedule[]> {
        const rows = await this.db.query<any>(
            "SELECT * FROM schedules WHERE chat_id=$1 AND active=1", [chatId]
        );
        return rows.map(rowToSchedule);
    }

    async getSchedule(chatId: number, scheduleId: string): Promise<Schedule | null> {
        const row = await this.db.queryOne<any>(
            "SELECT * FROM schedules WHERE chat_id=$1 AND id=$2", [chatId, scheduleId]
        );
        return row ? rowToSchedule(row) : null;
    }

    async getDueSchedules(): Promise<Array<{ chatId: number; schedule: Schedule }>> {
        const rows = await this.db.query<any>(
            "SELECT * FROM schedules WHERE active=1 AND awaiting_action=0 AND next_execution<=$1",
            [Date.now()]
        );
        return rows.map(row => ({ chatId: Number(row.chat_id), schedule: rowToSchedule(row) }));
    }

    async markNotified(chatId: number, scheduleId: string): Promise<void> {
        await this.db.run(
            "UPDATE schedules SET awaiting_action=1 WHERE chat_id=$1 AND id=$2",
            [chatId, scheduleId]
        );
    }

    async markExecuted(chatId: number, scheduleId: string): Promise<void> {
        const s = await this.getSchedule(chatId, scheduleId);
        if (!s) return;
        const next = advanceSchedule(new Date(s.nextExecution), s.frequency);
        if (next) {
            await this.db.run(
                "UPDATE schedules SET awaiting_action=0, next_execution=$1 WHERE chat_id=$2 AND id=$3",
                [next.getTime(), chatId, scheduleId]
            );
        } else {
            await this.db.run(
                "UPDATE schedules SET active=0 WHERE chat_id=$1 AND id=$2",
                [chatId, scheduleId]
            );
        }
    }

    async cancelSchedule(chatId: number, scheduleId: string): Promise<boolean> {
        const row = await this.db.queryOne<any>(
            "SELECT 1 FROM schedules WHERE chat_id=$1 AND id=$2 AND active=1", [chatId, scheduleId]
        );
        if (!row) return false;
        await this.db.run(
            "UPDATE schedules SET active=0 WHERE chat_id=$1 AND id=$2", [chatId, scheduleId]
        );
        return true;
    }

    async cancelAllSchedules(chatId: number): Promise<number> {
        const rows = await this.db.query<any>(
            "SELECT count(*) as cnt FROM schedules WHERE chat_id=$1 AND active=1", [chatId]
        );
        const count = Number(rows[0]?.cnt ?? 0);
        await this.db.run("UPDATE schedules SET active=0 WHERE chat_id=$1", [chatId]);
        return count;
    }
}

function rowToSchedule(row: any): Schedule {
    return {
        id: row.id,
        vendor: row.vendor,
        address: row.address,
        amount: Number(row.amount),
        token: row.token as "USDC" | "EURC",
        frequency: row.frequency as Frequency,
        nextExecution: Number(row.next_execution),
        active: !!row.active,
        createdAt: Number(row.created_at),
        awaitingAction: !!row.awaiting_action,
    };
}
