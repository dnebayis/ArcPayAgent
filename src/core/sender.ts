import { Readable } from "stream";
import { safeSend } from "../utils/telegram";
import type { ConversationMemory } from "../memory/conversation";
import type TelegramBot from "node-telegram-bot-api";
import { logger } from "../utils/logger";

/**
 * Centralized sender. Every outgoing message goes through here
 * to ensure conversation memory stays in sync.
 */
export class Sender {
    private bot: TelegramBot;
    private memory: ConversationMemory;

    constructor(bot: TelegramBot, memory: ConversationMemory) {
        this.bot = bot;
        this.memory = memory;
    }

    async send(chatId: number, text: string, opts?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message | undefined> {
        this.memory.addBotMessage(chatId, text);
        return safeSend(this.bot, chatId, text, opts);
    }

    async sendPhoto(chatId: number, buffer: Buffer, caption?: string): Promise<void> {
        try {
            const stream = Readable.from(buffer);
            await this.bot.sendPhoto(chatId, stream, { caption }, { contentType: "image/png" });
        } catch (err: any) {
            logger.error(chatId, "[Sender] sendPhoto failed", { error: err.message });
        }
    }

    async sendDocument(chatId: number, buffer: Buffer, filename: string, caption?: string, contentType = "application/octet-stream"): Promise<void> {
        try {
            const stream = Readable.from(buffer);
            await this.bot.sendDocument(chatId, stream, { caption }, { filename, contentType });
        } catch (err: any) {
            logger.error(chatId, "[Sender] sendDocument failed", { error: err.message });
        }
    }

    async sendCard(
        chatId: number,
        text: string,
        keyboard: any[][],
        opts?: TelegramBot.SendMessageOptions,
    ): Promise<TelegramBot.Message | undefined> {
        this.memory.addBotMessage(chatId, text);
        return safeSend(this.bot, chatId, text, {
            ...opts,
            reply_markup: { inline_keyboard: keyboard },
        });
    }
}
