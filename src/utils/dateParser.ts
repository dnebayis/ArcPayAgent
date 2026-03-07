/**
 * Parse natural language date/time expressions into timestamps.
 * Supports: "tomorrow", "next monday", "in 3 hours", "in 2 days", etc.
 */
export function parseScheduleDate(text: string): number | null {
    const lower = text.toLowerCase().trim();
    const now = new Date();

    // "tomorrow"
    if (lower === "tomorrow" || lower === "yarın" || lower === "yarin") {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0); // default to 9am
        return d.getTime();
    }

    // "today"
    if (lower === "today" || lower === "bugün" || lower === "bugun") {
        const d = new Date(now);
        d.setHours(d.getHours() + 1, 0, 0, 0);
        return d.getTime();
    }

    // "in X hours/minutes/days" or just "X minutes/hours" / "X dakika sonra"
    const inPattern = /^(?:in\s+)?(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|sn|saniye|dk|dakika|saat|g|gün|gun|h|hafta)(?:\s+sonra[sına]*)?$/i;
    const inMatch = lower.match(inPattern);
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
    const nextDayMatch = lower.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
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

    const days = Math.floor(hours / 24);
    if (days === 1) return "tomorrow";
    if (days < 7) return `in ${days} days`;

    const d = new Date(timestamp);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
