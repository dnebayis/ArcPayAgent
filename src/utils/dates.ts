/**
 * Parse natural-language schedule expressions into a Date.
 * English only. Supports: "tomorrow 9am", "in 30 minutes", "next monday", "2026-04-01 14:00".
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseScheduleTime(input: string): Date | null {
    const text = input.trim().toLowerCase();
    const now = new Date();

    // ISO / date-like: "2026-04-01 14:00"
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (isoMatch) {
        const [, datePart, h, m] = isoMatch;
        const d = new Date(datePart + "T" + (h ? `${h.padStart(2, "0")}:${m}` : "09:00") + ":00");
        return isNaN(d.getTime()) ? null : d;
    }

    // "in X minutes/hours/days/weeks"
    const relMatch = text.match(/^(?:in\s+)?(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?\b/i);
    if (relMatch) {
        const n = parseInt(relMatch[1], 10);
        const unit = relMatch[2].toLowerCase();
        const ms = unit.startsWith("sec") ? n * 1000
            : unit.startsWith("min") ? n * 60_000
            : unit.startsWith("h") ? n * 3_600_000
            : unit.startsWith("d") ? n * 86_400_000
            : unit.startsWith("w") ? n * 604_800_000
            : 0;
        return new Date(now.getTime() + ms);
    }

    // "tomorrow [HH:MM | Ham]"
    if (text.startsWith("tomorrow")) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        const timeStr = text.replace("tomorrow", "").trim();
        applyTime(d, timeStr);
        return d;
    }

    // "today [HH:MM]"
    if (text.startsWith("today")) {
        const d = new Date(now);
        const timeStr = text.replace("today", "").trim();
        applyTime(d, timeStr);
        return d;
    }

    // "next monday", "next friday 3pm"
    const nextMatch = text.match(/^next\s+(\w+)(?:\s+(.+))?$/);
    if (nextMatch) {
        const dayName = nextMatch[1];
        const dayIndex = WEEKDAYS.indexOf(dayName);
        if (dayIndex >= 0) {
            const d = new Date(now);
            let diff = dayIndex - d.getDay();
            if (diff <= 0) diff += 7;
            d.setDate(d.getDate() + diff);
            applyTime(d, nextMatch[2] || "");
            return d;
        }
    }

    // Bare weekday: "monday", "friday 3pm"
    for (const day of WEEKDAYS) {
        if (text.startsWith(day)) {
            const dayIndex = WEEKDAYS.indexOf(day);
            const d = new Date(now);
            let diff = dayIndex - d.getDay();
            if (diff <= 0) diff += 7;
            d.setDate(d.getDate() + diff);
            applyTime(d, text.replace(day, "").trim());
            return d;
        }
    }

    // Bare time: "9:00", "9am", "3:30pm", "15:00"
    // → today at that time, or tomorrow if already passed
    const bareTimeMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (bareTimeMatch) {
        const d = new Date(now);
        applyTime(d, text);
        // If the time has already passed today, schedule for tomorrow
        if (d.getTime() <= now.getTime()) {
            d.setDate(d.getDate() + 1);
        }
        return d;
    }

    return null;
}

function applyTime(d: Date, timeStr: string): void {
    if (!timeStr) { d.setHours(9, 0, 0, 0); return; }

    // "3pm", "3:30pm", "15:00"
    const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
        let h = parseInt(match[1], 10);
        const m = match[2] ? parseInt(match[2], 10) : 0;
        const ampm = match[3]?.toLowerCase();
        if (ampm === "pm" && h < 12) h += 12;
        if (ampm === "am" && h === 12) h = 0;
        d.setHours(h, m, 0, 0);
    } else {
        d.setHours(9, 0, 0, 0);
    }
}

export type Frequency = "once" | "daily" | "weekly" | "monthly";

export function parseFrequency(text: string): Frequency {
    const t = text.toLowerCase();
    if (t.includes("daily") || t.includes("every day")) return "daily";
    if (t.includes("weekly") || t.includes("every week")) return "weekly";
    if (t.includes("monthly") || t.includes("every month")) return "monthly";
    return "once";
}

export function advanceSchedule(date: Date, freq: Frequency): Date | null {
    if (freq === "once") return null;
    const next = new Date(date);
    if (freq === "daily") next.setDate(next.getDate() + 1);
    else if (freq === "weekly") next.setDate(next.getDate() + 7);
    else if (freq === "monthly") next.setMonth(next.getMonth() + 1);
    return next;
}
