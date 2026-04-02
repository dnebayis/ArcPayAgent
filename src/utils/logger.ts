type LogLevel = "info" | "warn" | "error" | "debug";

function log(level: LogLevel, traceId: string | number | null, message: string, data?: Record<string, unknown>): void {
    const entry = {
        ts: new Date().toISOString(),
        level,
        ...(traceId ? { traceId } : {}),
        msg: message,
        ...data,
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.log(line);
    }
}

export const logger = {
    info: (traceId: string | number | null, msg: string, data?: Record<string, unknown>) => log("info", traceId, msg, data),
    warn: (traceId: string | number | null, msg: string, data?: Record<string, unknown>) => log("warn", traceId, msg, data),
    error: (traceId: string | number | null, msg: string, data?: Record<string, unknown>) => log("error", traceId, msg, data),
    debug: (traceId: string | number | null, msg: string, data?: Record<string, unknown>) => log("debug", traceId, msg, data),
};
