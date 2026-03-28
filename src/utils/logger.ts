/**
 * Structured JSON logger with trace ID support.
 * Each log line is a JSON object so it can be parsed by log aggregators.
 *
 * Usage:
 *   import { logger } from "./logger";
 *   logger.info("t1a2b3", "Payment prepared", { chatId, amount });
 */

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, traceId: string | null, msg: string, meta?: Record<string, unknown>): void {
    const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...(traceId ? { traceId } : {}),
        ...meta,
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
    info(traceId: string | null, msg: string, meta?: Record<string, unknown>): void {
        emit("info", traceId, msg, meta);
    },
    warn(traceId: string | null, msg: string, meta?: Record<string, unknown>): void {
        emit("warn", traceId, msg, meta);
    },
    error(traceId: string | null, msg: string, meta?: Record<string, unknown>): void {
        emit("error", traceId, msg, meta);
    },
};
