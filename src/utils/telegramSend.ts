import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Send a Telegram message safely:
 * - Splits messages that exceed 4096 characters into chunks.
 * - Logs a warning if the send fails after the fallback attempt.
 * - Never throws — callers do not need to catch.
 */
export async function safeSend(
    bot: TelegramBot,
    chatId: number,
    text: string,
    opts?: TelegramBot.SendMessageOptions
): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
        try {
            await bot.sendMessage(chatId, chunk, opts as any);
        } catch (firstErr: any) {
            // Retry once: strip parse_mode (common cause of 400 errors on malformed markdown)
            // but KEEP reply_markup so inline keyboard buttons are preserved.
            const fallbackOpts = opts ? (({ parse_mode: _p, ...rest }) => rest)(opts as Record<string, unknown>) : undefined;
            try {
                await bot.sendMessage(chatId, chunk, fallbackOpts as any);
            } catch (secondErr: any) {
                logger.warn(null, "[Telegram] Message send failed after retry", {
                    chatId,
                    error: secondErr?.message ?? String(secondErr),
                    preview: chunk.slice(0, 80),
                });
            }
        }
    }
}

/**
 * Split a string into chunks no larger than TELEGRAM_MAX_LENGTH.
 * Tries to split on newlines to keep messages readable.
 */
function splitMessage(text: string): string[] {
    if (text.length <= TELEGRAM_MAX_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > TELEGRAM_MAX_LENGTH) {
        // Try to split at the last newline before the limit
        let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
        if (splitAt < TELEGRAM_MAX_LENGTH / 2) {
            // No good newline — hard cut
            splitAt = TELEGRAM_MAX_LENGTH;
        }
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}
