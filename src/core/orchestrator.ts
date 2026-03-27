import TelegramBot from "node-telegram-bot-api";
import { ConversationMemory } from "../agent/conversationMemory";
import { LLMKeyStore } from "../storage/llmKeyStore";
import { requestJsonCompletion, LLMJsonMessage } from "../ai/llmJsonClient";
import { buildSystemPrompt } from "../ai/systemPrompt";
import { ResearchTools, ResearchData } from "../tools/researchTools";
import { WalletStore } from "../storage/walletStore";
import { sanitizeForTelegram } from "../utils/telegramMarkdown";

const SYNTHESIS_PROMPT = `You are a helpful AI assistant. You have fetched live data to answer the user's query.
Synthesize the provided data into a natural, readable response. Be informative but brief.
IMPORTANT formatting rules:
- Never use CSV format. Always use plain sentences or a simple list.
- If a coin shows "price unavailable (not found on CoinGecko)", explicitly mention that in your response so the user knows why it's missing.
- For crypto prices, present each coin on its own line like: "ETH: $2,070 (-3.8% today)"
Return only valid JSON in this format: {"message": "your response here"}`;

export interface ParsedIntent {
    action?: string;
    message?: string;
    amount?: number;
    beneficiary?: string;
    name?: string;
    address?: string;
    schedule_time?: string;
    frequency?: string;
    memo?: string;
    symbols?: string[];
    token?: "USDC" | "EURC";
    from?: string;
    to?: string;
    [key: string]: unknown;
}

export class Orchestrator {
    constructor(
        private bot: TelegramBot,
        private llmKeyStore: LLMKeyStore,
        private memory: ConversationMemory,
        private walletStore: WalletStore,
        private researchTools: ResearchTools,
        private dispatchFn: (chatId: number, intent: ParsedIntent) => Promise<void>
    ) { }

    /**
     * Confirmation words that mean "approve the pending payment" — not a new command.
     * Matched against the full trimmed message (case-insensitive).
     */
    private static readonly CONFIRM_PATTERN = /^(yes|evet|confirm|onayla|tamam|devam|ok|go|go ahead|yes go|proceed|let's do it|do it|yap|yap bunu|onaylıyorum|tamamdır|kabul|sure|alright|yep|send it|gönder|gönder bunu)$/i;

    /**
     * Cancel words that mean "cancel the pending payment review" — not a schedule cancel.
     */
    private static readonly CANCEL_PATTERN = /^(cancel|iptal|iptal et|vazgeç|hayır|no|dur|stop|leave it)$/i;

    async handleMessage(chatId: number, text: string): Promise<void> {
        if (!text?.trim()) return;

        this.memory.addUserMessage(chatId, text);

        // ── Pending-payment guard ──────────────────────────────────────────────
        // When a payment card is on-screen, intercept pure confirm/cancel text
        // before it reaches the LLM — the LLM reliably re-creates the payment.
        const lastAction = this.memory.getContext(chatId).lastAction;
        if (lastAction === "create_payment") {
            const trimmed = text.trim();
            if (Orchestrator.CONFIRM_PATTERN.test(trimmed)) {
                const msg = "Please use the **Confirm** button above to complete the payment, or **Cancel** to cancel it.";
                await this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
                this.memory.addBotMessage(chatId, msg);
                return;
            }
            if (Orchestrator.CANCEL_PATTERN.test(trimmed)) {
                const msg = "Please use the **Cancel** button above to cancel this payment.";
                await this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
                this.memory.addBotMessage(chatId, msg);
                return;
            }
        }

        const auth = this.llmKeyStore.getKey(chatId);
        if (!auth) {
            const msg = "Please set your LLM key first to chat with me.\n\nUse: `/llmkey set openai sk-...`\n\nSupported providers: openai, anthropic, groq, deepseek, gemini, qwen, together, mistral, openrouter";
            await this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
            return;
        }

        const context = this.memory.buildContextSummary(chatId);
        const history = this.memory.getHistory(chatId).slice(-100);

        const systemContent = buildSystemPrompt(context);

        const messages: LLMJsonMessage[] = [
            { role: "system", content: systemContent },
            ...history,
            { role: "user", content: text }
        ];

        // Keep typing indicator alive while LLM processes (Telegram clears it after ~5s)
        void this.bot.sendChatAction(chatId, "typing").catch(() => { });
        const typingInterval = setInterval(() => {
            void this.bot.sendChatAction(chatId, "typing").catch(() => { });
        }, 4000);

        let raw: string | null = null;
        try {
            raw = await requestJsonCompletion(auth, messages);
        } catch (error: any) {
            console.error("[Orchestrator] LLM call failed:", error.message);
        } finally {
            clearInterval(typingInterval);
        }

        if (!raw) {
            const errMsg = "I'm having trouble connecting right now. Please try again in a moment.";
            await this.bot.sendMessage(chatId, errMsg);
            return;
        }

        let intent: ParsedIntent;
        try {
            intent = JSON.parse(raw);
        } catch {
            console.error("[Orchestrator] Failed to parse LLM response:", raw?.substring(0, 200));
            const errMsg = "I didn't understand that. Could you rephrase?";
            await this.bot.sendMessage(chatId, errMsg);
            this.memory.addBotMessage(chatId, errMsg);
            return;
        }

        if (!intent.action) {
            // No action — send the conversational message directly
            if (intent.message && typeof intent.message === "string") {
                await this.bot.sendMessage(chatId, intent.message);
                this.memory.addBotMessage(chatId, intent.message);
            }
            return;
        }

        // Handle research actions (send status message first, then fetch + synthesize)
        if (this.researchTools.isResearchAction(intent.action)) {
            if (intent.message && typeof intent.message === "string") {
                await this.bot.sendMessage(chatId, intent.message);
                this.memory.addBotMessage(chatId, intent.message);
            }
            await this.handleResearch(chatId, intent, text, auth);
            return;
        }

        // Send the LLM's conversational message before dispatching the action
        if (intent.message && typeof intent.message === "string") {
            await this.bot.sendMessage(chatId, intent.message);
            this.memory.addBotMessage(chatId, intent.message);
        }

        try {
            await this.dispatchFn(chatId, intent);
            this.memory.setLastAction(chatId, intent.action!);
        } catch (error: any) {
            console.error(`[Orchestrator] Dispatch error for action ${intent.action}:`, error.message);
            await this.bot.sendMessage(chatId, "Something went wrong. Please try again.");
        }
    }

    private async handleResearch(
        chatId: number,
        intent: ParsedIntent,
        originalQuery: string,
        auth: { provider: string; key: string; model?: string }
    ): Promise<void> {
        const walletAddress = this.walletStore.getWalletAddress(chatId);
        const data: ResearchData = await this.researchTools.fetch(intent as import("../tools/researchTools").ResearchIntent, walletAddress);

        if (data.type === "error") {
            const errMsg = `I couldn't fetch that data right now: ${data.message}`;
            await this.bot.sendMessage(chatId, errMsg);
            this.memory.addBotMessage(chatId, errMsg);
            return;
        }

        const formattedData = ResearchTools.formatForLLM(data);

        const synthesisMessages: LLMJsonMessage[] = [
            { role: "system", content: SYNTHESIS_PROMPT },
            { role: "user", content: `User's question: ${originalQuery}\n\nLive data:\n${formattedData}` }
        ];

        const synthRaw = await requestJsonCompletion(auth, synthesisMessages).catch(() => null);

        let resultMsg = formattedData; // fallback to raw data
        if (synthRaw) {
            try {
                const { message } = JSON.parse(synthRaw);
                if (message) resultMsg = message;
            } catch { /* use fallback */ }
        }

        await this.bot.sendMessage(chatId, resultMsg);
        this.memory.addBotMessage(chatId, resultMsg);
    }

}
