import TelegramBot from "node-telegram-bot-api";
import { logger } from "../utils/logger";
import { getConfig } from "../config";
import type { Orchestrator } from "../core/orchestrator";
import type { Sender } from "../core/sender";
import type { PaymentEngine } from "../engines/payment";
import type { InvoiceEngine } from "../engines/invoice";
import type { RequestEngine } from "../engines/requests";
import type { LLMKeyStore } from "../store/keys";
import type { PaymentRequestStore } from "../store/requests";
import type { ConversationMemory } from "../memory/conversation";
import { AccessControl } from "../middleware/access";
import { RateLimiter } from "../middleware/rateLimit";
import { attachMessageHandlers } from "./messages";
import { attachCallbackHandlers } from "./callbacks";

export interface BotDeps {
    orchestrator: Orchestrator;
    sender: Sender;
    paymentEngine: PaymentEngine;
    invoiceEngine: InvoiceEngine;
    requestEngine: RequestEngine;
    requests: PaymentRequestStore;
    keys: LLMKeyStore;
    memory: ConversationMemory;
    access: AccessControl;
    limiter: RateLimiter;
}

/**
 * Attach all Telegram event handlers to an existing bot instance.
 * Does NOT create the bot — caller provides it.
 */
export function attachHandlers(bot: TelegramBot, deps: Omit<BotDeps, "access" | "limiter">): void {
    const config = getConfig();
    const fullDeps: BotDeps = {
        ...deps,
        access: new AccessControl(config.ALLOWED_CHAT_IDS),
        limiter: new RateLimiter(),
    };

    attachMessageHandlers(bot, fullDeps);
    attachCallbackHandlers(bot, fullDeps);

    bot.on("polling_error", (err) => {
        logger.error(null, "[Bot] Polling error", { error: err.message });
    });
}
