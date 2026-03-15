import TelegramBot from "node-telegram-bot-api";
import { ParsedIntent } from "../ai/intentParser";
import { ToolRegistry } from "./toolRegistry";
import { SessionStore } from "./sessionStore";

export class ToolRouter {
    constructor(
        private bot: TelegramBot,
        private registry: ToolRegistry,
        private sessionStore?: SessionStore
    ) { }

    /**
     * Route a validated intent to the correct tool handler
     * The LLM never executes — only the engine does
     */
    async routeIntent(chatId: number, intent: ParsedIntent): Promise<boolean> {
        if (intent.needsClarification || intent.safeToExecute === false) {
            if (this.sessionStore && (intent.action === "create_payment" || intent.action === "schedule_payment")) {
                this.sessionStore.setPendingIntent(chatId, {
                    action: intent.action,
                    amount: intent.amount,
                    beneficiary: intent.beneficiary,
                    schedule_time: intent.schedule_time
                });
            }
            const ask = intent.message || this.buildClarification(intent);
            this.bot.sendMessage(chatId, ask);
            return false;
        }

        const tool = this.registry.get(intent.action);

        if (!tool) {
            const fallbackMsg = intent.message || "I can help with wallets, payments, vendors, invoices, schedules, and spending reports.";
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
            if (this.sessionStore) {
                this.sessionStore.clearPendingIntent(chatId);
            }
            return true;
        } catch (error: any) {
            this.bot.sendMessage(chatId, `❌ I couldn't complete that action: ${error.message}`);
            return false;
        }
    }

    private buildClarification(intent: ParsedIntent): string {
        if (intent.action === "create_payment") {
            if (intent.amount && !intent.beneficiary) {
                return `Who should I send ${intent.amount} USDC to? Use a saved vendor or a full 0x address.`;
            }
            if (!intent.amount && intent.beneficiary) {
                return `How much USDC should I send to ${intent.beneficiary}?`;
            }
            return "Tell me the amount and recipient. Example: `send 5 usdc to jack`";
        }

        if (intent.action === "schedule_payment") {
            if (intent.amount && intent.beneficiary && !intent.schedule_time) {
                return `When should I schedule ${intent.amount} USDC to ${intent.beneficiary}? Example: \`tomorrow 12:00\``;
            }
            if (intent.amount && !intent.beneficiary) {
                return "Who should I schedule this payment to? Use a saved vendor or a full 0x address.";
            }
            if (!intent.amount && intent.beneficiary) {
                return `How much USDC should I schedule for ${intent.beneficiary}?`;
            }
            return "Tell me the amount, recipient, and time. Example: `schedule payment 10 usdc to aws tomorrow` or `schedule payment 10 usdc to 0x... in 1 minute`";
        }

        return "Please clarify what you want me to do.";
    }
}
