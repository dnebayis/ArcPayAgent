import TelegramBot from "node-telegram-bot-api";
import { ParsedIntent } from "../ai/intentParser";
import { ToolRegistry } from "./toolRegistry";

export class ToolRouter {
    constructor(
        private bot: TelegramBot,
        private registry: ToolRegistry
    ) { }

    /**
     * Route a validated intent to the correct tool handler
     * The LLM never executes — only the engine does
     */
    async routeIntent(chatId: number, intent: ParsedIntent): Promise<boolean> {
        const tool = this.registry.get(intent.action);

        if (!tool) {
            const fallbackMsg = intent.message || "I can help you send payments, analyze invoices, create payment requests, or show spending reports.";
            this.bot.sendMessage(chatId, fallbackMsg);
            return false;
        }

        if (intent.confidence !== undefined && intent.confidence < 0.45) {
            const ask = intent.message || "To be sure: what exactly would you like me to do?";
            this.bot.sendMessage(chatId, ask);
            return false;
        }

        try {
            await tool.handler(chatId, intent);
            return true;
        } catch (error: any) {
            this.bot.sendMessage(chatId, `❌ Error executing action: ${error.message}`);
            return false;
        }
    }
}
