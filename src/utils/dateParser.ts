/**
 * Parse natural language date/time expressions into timestamps.
 * Supports: "tomorrow", "next monday", "in 3 hours", "in 2 days", etc.
 */
export function parseScheduleDate(text: string): number | null {
    const lower = text.toLowerCase().trim();
    const normalized = lower
        .replace(/^(?:in|on|for)\s+/, "")
        .replace(/(\d{1,2}(?::\d{2})?)\s+in\s+the\s+(morning|afternoon|evening|night)\b/g, (_match, time: string, period: string) => {
            const meridiem = period === "morning" ? "am" : "pm";
            return `${time} ${meridiem}`;
        });
    const now = new Date();
    const namedTimeMatch = normalized.match(/^(tomorrow|today|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(morning|afternoon|evening|night)$/i);

    if (namedTimeMatch) {
        const baseExpr = namedTimeMatch[1].toLowerCase();
        const namedTime = namedTimeMatch[2].toLowerCase();
        const hoursByNamedTime: Record<string, number> = {
            morning: 9,
            afternoon: 15,
            evening: 19,
            night: 21
        };

        let baseTimestamp: number | null = null;
        if (baseExpr === "tomorrow") {
            const d = new Date(now);
            d.setDate(d.getDate() + 1);
            baseTimestamp = d.getTime();
        } else if (baseExpr === "today") {
            baseTimestamp = now.getTime();
        } else {
            const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
            const targetDay = dayNames.indexOf(baseExpr.replace(/^next\s+/, ""));
            if (targetDay >= 0) {
                const d = new Date(now);
                const currentDay = d.getDay();
                let daysUntil = targetDay - currentDay;
                if (daysUntil <= 0) daysUntil += 7;
                d.setDate(d.getDate() + daysUntil);
                baseTimestamp = d.getTime();
            }
        }

        if (baseTimestamp !== null) {
            const d = new Date(baseTimestamp);
            d.setHours(hoursByNamedTime[namedTime], 0, 0, 0);
            return d.getTime();
        }
    }

    const timeOfDayMatch = normalized.match(/^(tomorrow|today|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

    if (timeOfDayMatch) {
        const baseExpr = timeOfDayMatch[1].toLowerCase();
        let hours = parseInt(timeOfDayMatch[2], 10);
        const minutes = parseInt(timeOfDayMatch[3] || "0", 10);
        const meridiem = timeOfDayMatch[4]?.toLowerCase();

        if (meridiem === "pm" && hours < 12) hours += 12;
        if (meridiem === "am" && hours === 12) hours = 0;

        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            let baseTimestamp: number | null = null;

            if (baseExpr === "tomorrow") {
                const d = new Date(now);
                d.setDate(d.getDate() + 1);
                baseTimestamp = d.getTime();
            } else if (baseExpr === "today") {
                baseTimestamp = now.getTime();
            } else {
                const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                const targetDay = dayNames.indexOf(baseExpr.replace(/^next\s+/, ""));
                if (targetDay >= 0) {
                    const d = new Date(now);
                    const currentDay = d.getDay();
                    let daysUntil = targetDay - currentDay;
                    if (daysUntil <= 0) daysUntil += 7;
                    d.setDate(d.getDate() + daysUntil);
                    baseTimestamp = d.getTime();
                }
            }

            if (baseTimestamp !== null) {
                const d = new Date(baseTimestamp);
                d.setHours(hours, minutes, 0, 0);
                return d.getTime();
            }
        }
    }

    // "tomorrow"
    if (normalized === "tomorrow" || normalized === "yarın" || normalized === "yarin") {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0); // default to 9am
        return d.getTime();
    }

    // "today"
    if (normalized === "today" || normalized === "bugün" || normalized === "bugun") {
        const d = new Date(now);
        d.setHours(d.getHours() + 1, 0, 0, 0);
        return d.getTime();
    }

    // "in X hours/minutes/days" / "after X seconds" / just "X minutes"
    const inPattern = /^(?:(?:in|after)\s+)?(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|sn|saniye|dk|dakika|saat|g|gün|gun|h|hafta)(?:\s+sonra[sına]*)?$/i;
    const inMatch = normalized.match(inPattern);
    if (inMatch) {
        const n = parseInt(inMatch[1]);
        const matchedUnit = inMatch[2].toLowerCase();

        let unit = "minute"; // default
        if (matchedUnit.startsWith("s") || matchedUnit === "sn") unit = "second";
        if (matchedUnit.startsWith("m") || matchedUnit.startsWith("d")) unit = "minute";
        if (matchedUnit.startsWith("h") || matchedUnit === "saat") unit = "hour";
        if (matchedUnit.startsWith("d") || matchedUnit.startsWith("g")) unit = "day"; // day, days, gün, gun, g
        if (matchedUnit.startsWith("w") || matchedUnit === "hafta") unit = "week"; // week, weeks, hafta

        // precise tr mappings overrides if collision
        if (matchedUnit === "sn" || matchedUnit === "saniye") unit = "second";
        if (matchedUnit === "dk" || matchedUnit === "dakika" || matchedUnit === "dakikaya") unit = "minute";
        if (matchedUnit === "saat" || matchedUnit === "saate") unit = "hour";
        if (matchedUnit === "g" || matchedUnit === "g" || matchedUnit === "gün" || matchedUnit === "gun" || matchedUnit === "güne") unit = "day";
        if (matchedUnit === "h" || matchedUnit === "hafta") unit = "week";

        const ms: Record<string, number> = {
            second: 1000,
            minute: 60 * 1000,
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000
        };
        if (ms[unit]) return now.getTime() + n * ms[unit];
    }

    // "next monday" / "next friday" etc.
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const nextDayMatch = normalized.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
    if (nextDayMatch) {
        const targetDay = dayNames.indexOf(nextDayMatch[1].toLowerCase());
        const d = new Date(now);
        const currentDay = d.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        d.setDate(d.getDate() + daysUntil);
        d.setHours(9, 0, 0, 0);
        return d.getTime();
    }

    const plainDayMatch = normalized.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
    if (plainDayMatch) {
        const targetDay = dayNames.indexOf(plainDayMatch[1].toLowerCase());
        const d = new Date(now);
        const currentDay = d.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        d.setDate(d.getDate() + daysUntil);
        d.setHours(9, 0, 0, 0);
        return d.getTime();
    }

    return null;
}

/**
 * Format a timestamp into a human-readable relative string
 */
export function formatScheduleTime(timestamp: number): string {
    const now = Date.now();
    const diff = timestamp - now;

    if (diff < 0) return "overdue";

    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `in ${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `in ${hours}h`;

    const nowDate = new Date(now);
    const targetDate = new Date(timestamp);
    const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    const startOfTargetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    const dayDiff = Math.round((startOfTargetDay - startOfToday) / (24 * 60 * 60 * 1000));
    if (dayDiff === 1) return "tomorrow";

    const days = Math.floor(hours / 24);
    if (days < 7) return `in ${days} days`;

    const d = new Date(timestamp);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
