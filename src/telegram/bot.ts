import fs from "node:fs/promises";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";

const AUDIT_DIR = path.resolve(process.cwd(), ".telegram-audit");
const AUDIT_PATH = path.join(AUDIT_DIR, "outbound.jsonl");

type AuditEntry = {
    ts: string;
    event: "send_attempt" | "send_success" | "send_failure";
    chatId: TelegramBot.ChatId;
    text: string;
    parseMode?: string;
    messageId?: number;
    error?: string;
};

let auditReady: Promise<void> | null = null;

async function ensureAuditDir(): Promise<void> {
    if (!auditReady) {
        auditReady = fs.mkdir(AUDIT_DIR, { recursive: true }).then(() => undefined);
    }

    await auditReady;
}

async function writeAudit(entry: AuditEntry): Promise<void> {
    if (process.env.TELEGRAM_AUDIT_LOG === "0") {
        return;
    }

    try {
        await ensureAuditDir();
        await fs.appendFile(AUDIT_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
        console.warn("[Telegram Bot] Failed to write audit log:", error);
    }
}

export function createBot(token: string, polling: boolean = false) {
    const bot = new TelegramBot(token, { polling });

    // Catch bot message formatting errors (like invalid Markdown from LLMs)
    const originalSendMessage = bot.sendMessage.bind(bot);
    bot.sendMessage = async (chatId: TelegramBot.ChatId, text: string, options?: TelegramBot.SendMessageOptions) => {
        await writeAudit({
            ts: new Date().toISOString(),
            event: "send_attempt",
            chatId,
            text,
            parseMode: options?.parse_mode,
        });

        try {
            const result = await originalSendMessage(chatId, text, options);
            await writeAudit({
                ts: new Date().toISOString(),
                event: "send_success",
                chatId,
                text,
                parseMode: options?.parse_mode,
                messageId: result.message_id,
            });
            return result;
        } catch (error: any) {
            // Check if error is due to markdown entity parsing format issues
            if (options?.parse_mode && error.message && error.message.includes("can't parse entities")) {
                console.warn(`[Telegram Bot] Retrying without parse_mode due to entity error for chat ${chatId}: ${error.message}`);
                const fallbackOptions = { ...options };
                delete fallbackOptions.parse_mode;
                const fallbackResult = await originalSendMessage(chatId, text, fallbackOptions);
                await writeAudit({
                    ts: new Date().toISOString(),
                    event: "send_success",
                    chatId,
                    text,
                    messageId: fallbackResult.message_id,
                });
                return fallbackResult;
            }

            // For unhandled callers, prevent strict crash but log it
            await writeAudit({
                ts: new Date().toISOString(),
                event: "send_failure",
                chatId,
                text,
                parseMode: options?.parse_mode,
                error: error?.message ?? String(error),
            });
            console.error(`[Telegram Bot] Failed to send message to ${chatId}:`, error.message);
            throw error;
        }
    };

    // Prevent polling errors from crashing the Node.js process outright
    bot.on("polling_error", (err) => {
        console.error("[Telegram Polling Error]", err.message);
    });

    return bot;
}
