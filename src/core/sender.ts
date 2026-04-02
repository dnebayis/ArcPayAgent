import { safeSend } from "../utils/telegram";
import type { ConversationMemory } from "../memory/conversation";
import type TelegramBot from "node-telegram-bot-api";

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
