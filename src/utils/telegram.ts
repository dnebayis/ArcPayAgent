import TelegramBot from "node-telegram-bot-api";
import { logger } from "./logger";

const MAX_LENGTH = 4096;

/**
 * Send a message safely, splitting if needed, with markdown fallback.
 */
export async function safeSend(
    bot: TelegramBot,
    chatId: number,
    text: string,
    opts?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message | undefined> {
    if (!text?.trim()) return undefined;

    const chunks = splitMessage(text, MAX_LENGTH);
    let lastMsg: TelegramBot.Message | undefined;

    for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        // Only apply reply_markup to last chunk
        const chunkOpts = isLast ? opts : { ...opts, reply_markup: undefined };
        try {
            lastMsg = await bot.sendMessage(chatId, chunks[i], chunkOpts);
        } catch (err: any) {
            // Retry without parse_mode if markdown fails
            if (chunkOpts?.parse_mode && err?.response?.body?.description?.includes("can't parse")) {
                const { parse_mode, ...fallback } = chunkOpts;
                try {
                    lastMsg = await bot.sendMessage(chatId, chunks[i], fallback);
                } catch (retryErr: any) {
                    logger.warn(null, "[safeSend] Retry without parse_mode also failed", {
                        chatId, error: retryErr?.message,
                    });
                }
            } else {
                logger.warn(null, "[safeSend] Failed to send message", {
                    chatId, error: err?.message, preview: text.slice(0, 80),
                });
            }
        }
    }
    return lastMsg;
}

function splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }
        // Try to split at newline
        let splitAt = remaining.lastIndexOf("\n", maxLen);
        if (splitAt < maxLen * 0.3) splitAt = maxLen;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
}
