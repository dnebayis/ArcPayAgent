import TelegramBot from "node-telegram-bot-api";

export function createBot(token: string, polling: boolean = false) {
    const bot = new TelegramBot(token, { polling });

    // Catch bot message formatting errors (like invalid Markdown from LLMs)
    const originalSendMessage = bot.sendMessage.bind(bot);
    bot.sendMessage = async (chatId: TelegramBot.ChatId, text: string, options?: TelegramBot.SendMessageOptions) => {
        try {
            return await originalSendMessage(chatId, text, options);
        } catch (error: any) {
            // Check if error is due to markdown entity parsing format issues
            if (options?.parse_mode && error.message && error.message.includes("can't parse entities")) {
                console.warn(`[Telegram Bot] Retrying without parse_mode due to entity error for chat ${chatId}: ${error.message}`);
                const fallbackOptions = { ...options };
                delete fallbackOptions.parse_mode;
                return await originalSendMessage(chatId, text, fallbackOptions);
            }

            // For unhandled callers, prevent strict crash but log it
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
