import { describe, it, expect, vi } from "vitest";
import { ScheduleStore } from "../../src/storage/schedules";
import { parseScheduleDate, formatScheduleTime } from "../../src/utils/dateParser";

describe("ScheduleStore", () => {
    it("should create and retrieve a schedule", () => {
        const store = new ScheduleStore();
        const future = Date.now() + 60 * 60 * 1000;

        const schedule = store.createSchedule(1, "aws", "0x001", 50, future, "once");

        expect(schedule.id).toBeTruthy();
        expect(schedule.vendor).toBe("aws");
        expect(schedule.amount).toBe(50);
        expect(schedule.active).toBe(true);

        const schedules = store.getSchedules(1);
        expect(schedules.length).toBe(1);
        expect(schedules[0].id).toBe(schedule.id);
    });

    it("should find due schedules", () => {
        const store = new ScheduleStore();
        const past = Date.now() - 1000;
        const future = Date.now() + 60 * 60 * 1000;

        store.createSchedule(1, "aws", "0x001", 50, past);
        store.createSchedule(1, "gcp", "0x002", 30, future);

        const due = store.getDueSchedules();
        expect(due.length).toBe(1);
        expect(due[0].schedule.vendor).toBe("aws");
    });

    it("should deactivate one-time schedule after execution", () => {
        const store = new ScheduleStore();
        const past = Date.now() - 1000;

        const schedule = store.createSchedule(1, "aws", "0x001", 50, past, "once");
        store.markExecuted(1, schedule.id);

        const schedules = store.getSchedules(1);
        expect(schedules.length).toBe(0); // deactivated
    });

    it("should advance weekly schedule after execution", () => {
        const store = new ScheduleStore();
        const now = Date.now();

        const schedule = store.createSchedule(1, "aws", "0x001", 50, now, "weekly");
        const originalTime = schedule.nextExecution;
        store.markExecuted(1, schedule.id);

        const schedules = store.getSchedules(1);
        expect(schedules.length).toBe(1);
        expect(schedules[0].nextExecution).toBe(originalTime + 7 * 24 * 60 * 60 * 1000);
    });

    it("should advance monthly schedule after execution", () => {
        const store = new ScheduleStore();
        const jan15 = new Date("2026-01-15T09:00:00").getTime();

        const schedule = store.createSchedule(1, "aws", "0x001", 50, jan15, "monthly");
        store.markExecuted(1, schedule.id);

        const schedules = store.getSchedules(1);
        expect(schedules.length).toBe(1);
        const next = new Date(schedules[0].nextExecution);
        expect(next.getMonth()).toBe(1); // February
    });

    it("should cancel a schedule", () => {
        const store = new ScheduleStore();
        const future = Date.now() + 60 * 60 * 1000;

        const schedule = store.createSchedule(1, "aws", "0x001", 50, future);
        const result = store.cancelSchedule(1, schedule.id);

        expect(result).toBe(true);
        expect(store.getSchedules(1).length).toBe(0);
    });

    it("should cancel all schedules", () => {
        const store = new ScheduleStore();
        const future = Date.now() + 60 * 60 * 1000;

        store.createSchedule(1, "aws", "0x001", 50, future);
        store.createSchedule(1, "gcp", "0x002", 30, future);

        const count = store.cancelAllSchedules(1);
        expect(count).toBe(2);
        expect(store.getSchedules(1).length).toBe(0);
    });
});

describe("parseScheduleDate", () => {
    it("should parse 'tomorrow'", () => {
        const result = parseScheduleDate("tomorrow");
        expect(result).not.toBeNull();
        const d = new Date(result!);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        expect(d.getDate()).toBe(tomorrow.getDate());
    });

    it("should parse 'in 3 hours'", () => {
        const now = Date.now();
        const result = parseScheduleDate("in 3 hours");
        expect(result).not.toBeNull();
        const diff = result! - now;
        expect(diff).toBeGreaterThan(3 * 60 * 60 * 1000 - 1000);
        expect(diff).toBeLessThan(3 * 60 * 60 * 1000 + 1000);
    });

    it("should parse 'in 2 days'", () => {
        const now = Date.now();
        const result = parseScheduleDate("in 2 days");
        expect(result).not.toBeNull();
        const diff = result! - now;
        expect(diff).toBeGreaterThan(2 * 24 * 60 * 60 * 1000 - 1000);
    });

    it("should parse 'next monday'", () => {
        const result = parseScheduleDate("next monday");
        expect(result).not.toBeNull();
        const d = new Date(result!);
        expect(d.getDay()).toBe(1); // Monday
    });

    it("should parse Turkish inputs like 'yarın', '1 dakika', '2 saat sonra'", () => {
        expect(parseScheduleDate("yarın")).not.toBeNull();

        const inOneMin = parseScheduleDate("1 dakika")!;
        expect(inOneMin - Date.now()).toBeGreaterThan(50 * 1000);
        expect(inOneMin - Date.now()).toBeLessThan(70 * 1000);

        const inTwoHours = parseScheduleDate("2 saat sonra")!;
        expect(inTwoHours - Date.now()).toBeGreaterThan(1.9 * 60 * 60 * 1000);
    });

    it("should return null for unparseable input", () => {
        expect(parseScheduleDate("asdfghjkl")).toBeNull();
    });
});

describe("formatScheduleTime", () => {
    it("should format near-future times", () => {
        const inOneHour = Date.now() + 60 * 60 * 1000 + 100; // adding 100ms prevents rounding down to 59m
        expect(formatScheduleTime(inOneHour)).toBe("in 1h");
    });

    it("should format tomorrow", () => {
        const inOneDay = Date.now() + 24 * 60 * 60 * 1000;
        expect(formatScheduleTime(inOneDay)).toBe("tomorrow");
    });

    it("should format overdue", () => {
        const pastTime = Date.now() - 60 * 60 * 1000;
        expect(formatScheduleTime(pastTime)).toBe("overdue");
    });
});
