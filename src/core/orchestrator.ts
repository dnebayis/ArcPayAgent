import TelegramBot from "node-telegram-bot-api";
import { randomUUID } from "node:crypto";
import { ConversationMemory } from "../agent/conversationMemory";
import { LLMKeyStore } from "../storage/llmKeyStore";
import { requestJsonCompletion, requestToolCompletion, LLMJsonMessage, AgentMessage } from "../ai/llmJsonClient";
import { buildSystemPrompt, buildSlimSystemPrompt } from "../ai/systemPrompt";
import { TOOL_DEFINITIONS, TERMINAL_ACTIONS } from "../ai/toolDefinitions";
import { ResearchTools, ResearchData } from "../tools/researchTools";
import { WalletStore } from "../storage/walletStore";
import { validateIntent } from "../ai/intentValidator";
import { logger } from "../utils/logger";

const MAX_AGENT_ITERATIONS = 4;

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
    private readonly useToolCalling: boolean;

    constructor(
        private bot: TelegramBot,
        private llmKeyStore: LLMKeyStore,
        private memory: ConversationMemory,
        private walletStore: WalletStore,
        private researchTools: ResearchTools,
        private dispatchFn: (chatId: number, intent: ParsedIntent) => Promise<string>,
        useToolCalling = false
    ) {
        this.useToolCalling = useToolCalling;
    }

    /**
     * Confirmation words that mean "approve the pending payment" — not a new command.
     * Matched against the full trimmed message (case-insensitive).
     */
    private static readonly CONFIRM_PATTERN = /^(yes|evet|confirm|onayla|tamam|devam|ok|go|go ahead|yes go|proceed|let's do it|do it|yap|yap bunu|onaylıyorum|tamamdır|kabul|sure|alright|yep|send it|gönder|gönder bunu)$/i;

    /**
     * Cancel words that mean "cancel the pending payment review" — not a schedule cancel.
     */
    private static readonly CANCEL_PATTERN = /^(cancel|iptal|iptal et|vazgeç|hayır|no|dur|stop|leave it)$/i;

    /**
     * Payment modification during pending payment (e.g. "not 1 eurc, send 10 eurc", "actually make it 50").
     * These should be blocked while a payment is awaiting confirmation.
     */
    private static readonly PAYMENT_MODIFY_PATTERN = /\b\d+(\.\d+)?\s*(usdc|eurc)\b|(send|pay)\s+\d+\s*(usdc|eurc)/i;

    /**
     * Capability queries — intercepted before the LLM to prevent agent_status misrouting.
     */
    private static readonly CAPABILITY_PATTERN = /\bwhat\s+(can|do)\s+you\b|\bwhat\s+are\s+you\b|\b(list|show|give|create)\b.{0,40}\b(what\s+you\s+can|capabilities|features|functions|abilities)\b|\bdetailed\s+list\b|\byour\s+(capabilities|features|functions|abilities)\b/i;

    private static readonly CAPABILITY_MESSAGE = "Here's what I can do:\n• Send USDC and EURC payments instantly\n• Schedule one-time or recurring payments\n• Save and manage vendors\n• Analyze invoice PDFs and photos for risk\n• Show spending reports, payment history, monthly breakdowns\n• Look up live crypto prices and fiat FX rates\n• Watch your wallet for incoming payment notifications\n• Set price alerts (e.g., \"alert me when BTC hits $100k\")\n• Answer questions about Arc and Circle\n• Show your on-chain activity on Arc Testnet\n\nWhat would you like to do?";

    /**
     * Actions where the dispatcher always produces its own real data output.
     * For these, the LLM's "message" field is only sent if it's a brief
     * loading indicator (≤120 chars). Long or fabricated messages are suppressed.
     */
    private static readonly DATA_DISPLAY_ACTIONS = new Set([
        // create_payment: engine sends the real payment card with buttons.
        // Suppress any LLM message longer than 120 chars (fabricated review cards).
        "create_payment",
        "list_vendors", "show_wallet", "monthly_spending",
        "show_recent_payments", "report", "spending_by_vendor", "list_schedules",
        "top_vendors", "list_price_alerts", "account_summary", "vendor_detail",
        "wallet_intelligence", "show_pending_payments", "agent_status",
        "agent_identity", "agent_validation_status", "watch_payments_status", "status",
    ]);

    /**
     * Returns true if the message looks like fabricated/placeholder data that
     * should be suppressed. Protects against LLMs that generate fake lists.
     */
    private static isFabricatedMessage(action: string | undefined, message: string): boolean {
        if (!action || !Orchestrator.DATA_DISPLAY_ACTIONS.has(action)) return false;
        if (/\[.{1,60}\]/.test(message)) return true;           // [Vendor Name], [Address]
        if (/^\s*\d+\.\s+\S/m.test(message)) return true;      // 1. Item\n2. Item
        if (/[-•]\s+\*\*/.test(message)) return true;           // - **Vendor** (markdown list)
        if (message.length > 120) return true;                  // Too long for a loading indicator
        if (/`?0x[a-fA-F0-9]{10,}`?/.test(message)) return true; // Fabricated hex address (e.g. USDC contract)
        return false;
    }


    async handleMessage(chatId: number, text: string): Promise<void> {
        if (!text?.trim()) return;

        const traceId = randomUUID().slice(0, 8);
        this.memory.addUserMessage(chatId, text);

        // ── Flow state guard ────────────────────────────────────────────────────
        // Use explicit flow state (2.3) when available, fall back to lastAction for backward compat
        const flowState = this.memory.getFlowState(chatId);
        const lastAction = this.memory.getContext(chatId).lastAction;
        const isPendingPayment = flowState?.name === "payment_awaiting_confirmation"
            || lastAction === "create_payment";

        if (isPendingPayment) {
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
            if (Orchestrator.PAYMENT_MODIFY_PATTERN.test(trimmed)) {
                const msg = "There's already a payment waiting for confirmation. Please use the **Cancel** button above to cancel it first, then I can process your new request.";
                await this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
                this.memory.addBotMessage(chatId, msg);
                return;
            }
        }

        // ── Capability query guard ─────────────────────────────────────────────
        if (Orchestrator.CAPABILITY_PATTERN.test(text.trim())) {
            await this.bot.sendMessage(chatId, Orchestrator.CAPABILITY_MESSAGE);
            this.memory.addBotMessage(chatId, Orchestrator.CAPABILITY_MESSAGE);
            return;
        }

        const auth = this.llmKeyStore.getKey(chatId);
        if (!auth) {
            const msg = "Please set your LLM key first to chat with me.\n\nUse: `/llmkey set openai sk-...`\n\nSupported providers: openai, anthropic, groq, deepseek, gemini, qwen, together, mistral, openrouter";
            await this.bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
            return;
        }

        if (this.useToolCalling) {
            await this.handleMessageWithTools(chatId, text, auth, traceId);
        } else {
            await this.handleMessageWithJson(chatId, text, auth, traceId);
        }
    }

    /** NEW: agent loop using native tool calling (USE_TOOL_CALLING=true) */
    private async handleMessageWithTools(
        chatId: number,
        text: string,
        auth: { provider: string; key: string; model?: string },
        traceId: string
    ): Promise<void> {
        const context = this.memory.buildContextSummary(chatId);
        const history = this.memory.getHistory(chatId).slice(-100);
        const systemContent = buildSlimSystemPrompt(context);

        const loopMessages: AgentMessage[] = [
            { role: "system", content: systemContent },
            ...history,
            { role: "user", content: text },
        ];
        let lastDispatchedTool: string | undefined;

        void this.bot.sendChatAction(chatId, "typing").catch(() => { });
        const typingInterval = setInterval(() => {
            void this.bot.sendChatAction(chatId, "typing").catch(() => { });
        }, 4000);

        try {
            for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
                const llmStart = Date.now();
                const toolResp = await requestToolCompletion(auth, loopMessages, TOOL_DEFINITIONS);

                if (!toolResp) {
                    const errMsg = "I'm having trouble connecting right now. Please try again in a moment.";
                    await this.bot.sendMessage(chatId, errMsg);
                    return;
                }

                logger.info(traceId, "[Orchestrator] Tool call response", {
                    chatId, iter,
                    latencyMs: toolResp.latencyMs ?? (Date.now() - llmStart),
                    promptTokens: toolResp.usage?.promptTokens,
                    completionTokens: toolResp.usage?.completionTokens,
                    totalTokens: toolResp.usage?.totalTokens,
                    toolName: toolResp.toolName, finishReason: toolResp.finishReason
                });

                // LLM decided not to call a tool — just a conversational response.
                // Apply the same fabrication guard as pre-tool messages so data-display
                // tools that didn't make the TERMINAL_ACTIONS list can't generate a
                // second fake response in a follow-up "stop" turn.
                if (!toolResp.toolName || toolResp.finishReason === "stop") {
                    if (toolResp.message
                        && !Orchestrator.isFabricatedMessage(lastDispatchedTool, toolResp.message)) {
                        await this.bot.sendMessage(chatId, toolResp.message);
                        this.memory.addBotMessage(chatId, toolResp.message);
                    }
                    break;
                }

                // Tool call — send pre-tool message if any (suppress fabricated data)
                if (toolResp.message
                    && !Orchestrator.isFabricatedMessage(toolResp.toolName, toolResp.message)) {
                    await this.bot.sendMessage(chatId, toolResp.message);
                    this.memory.addBotMessage(chatId, toolResp.message);
                }

                // Handle research actions via existing research path
                if (this.researchTools.isResearchAction(toolResp.toolName)) {
                    const intent: ParsedIntent = {
                        action: toolResp.toolName,
                        message: toolResp.message,
                        ...(toolResp.toolArgs as object)
                    };
                    await this.handleResearch(chatId, intent, text, auth);
                    this.memory.setLastAction(chatId, toolResp.toolName);
                    break;
                }

                // Build intent and dispatch
                const intent: ParsedIntent = {
                    action: toolResp.toolName,
                    message: toolResp.message,
                    ...(toolResp.toolArgs as object)
                };

                // Guard: missing or implicit amount for create_payment.
                // If user message has no digit, LLM likely reused lastPayment amount — ask explicitly.
                if (intent.action === "create_payment") {
                    const amount = Number(intent.amount);
                    const userHasDigit = /\d/.test(text);
                    if (!intent.amount || isNaN(amount) || amount <= 0 || !userHasDigit) {
                        const tok = (intent.token as string) ?? "USDC";
                        const ben = intent.beneficiary ? ` to ${String(intent.beneficiary)}` : "";
                        const msg = `How much ${tok} would you like to send${ben}?`;
                        await this.bot.sendMessage(chatId, msg);
                        this.memory.addBotMessage(chatId, msg);
                        break;
                    }
                }

                let toolResult: string;
                try {
                    toolResult = await this.dispatchFn(chatId, intent);
                } catch (error: unknown) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    logger.error(traceId, "[Orchestrator] Dispatch error", { chatId, action: toolResp.toolName, error: errMsg });
                    await this.bot.sendMessage(chatId, "Something went wrong. Please try again.");
                    break;
                }

                // Track last dispatched tool for fabrication guard in stop-branch
                lastDispatchedTool = toolResp.toolName;

                // Update flow state — only set payment_awaiting_confirmation when a card was
                // actually shown (empty toolResult means preparePayment returned early with an error).
                if (toolResp.toolName === "create_payment") {
                    if (toolResult) {
                        this.memory.setFlowState(chatId, { name: "payment_awaiting_confirmation", since: Date.now() });
                    }
                } else {
                    this.memory.setLastAction(chatId, toolResp.toolName);
                }

                // Add tool interaction to loop messages for potential next iteration
                const assistantContent = toolResp.message
                    ? `${toolResp.message}\n[Called: ${toolResp.toolName}]`
                    : `[Called: ${toolResp.toolName}]`;
                loopMessages.push({ role: "assistant", content: assistantContent });
                loopMessages.push({ role: "user", content: `[Tool result: ${toolResult || "Done."}]` });

                // If this tool handles its own full UX, stop looping
                if (TERMINAL_ACTIONS.has(toolResp.toolName)) break;

                // Otherwise continue — LLM may want to chain another action
            }
        } finally {
            clearInterval(typingInterval);
        }
    }

    /** EXISTING: single-shot JSON mode (default, backward compatible) */
    private async handleMessageWithJson(
        chatId: number,
        text: string,
        auth: { provider: string; key: string; model?: string },
        traceId: string
    ): Promise<void> {
        const context = this.memory.buildContextSummary(chatId);
        const history = this.memory.getHistory(chatId).slice(-100);
        const systemContent = buildSystemPrompt(context);

        const messages: LLMJsonMessage[] = [
            { role: "system", content: systemContent },
            ...history,
            { role: "user", content: text }
        ];

        void this.bot.sendChatAction(chatId, "typing").catch(() => { });
        const typingInterval = setInterval(() => {
            void this.bot.sendChatAction(chatId, "typing").catch(() => { });
        }, 4000);

        let raw: string | null = null;
        const llmStart = Date.now();
        try {
            raw = await requestJsonCompletion(auth, messages);
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(traceId, "[Orchestrator] LLM call failed", { chatId, error: errMsg });
        } finally {
            clearInterval(typingInterval);
        }

        if (!raw) {
            const errMsg = "I'm having trouble connecting right now. Please try again in a moment.";
            await this.bot.sendMessage(chatId, errMsg);
            return;
        }

        logger.info(traceId, "[Orchestrator] LLM response received", { chatId, latencyMs: Date.now() - llmStart });

        let intent: ParsedIntent;
        try {
            const parsed = JSON.parse(raw) as unknown;
            const validated = validateIntent(parsed);
            if (!validated) throw new Error("Intent validation failed");
            intent = validated;
        } catch {
            logger.warn(traceId, "[Orchestrator] Failed to parse/validate LLM response", { chatId, raw: raw?.substring(0, 200) });
            const errMsg = "I didn't understand that. Could you rephrase?";
            await this.bot.sendMessage(chatId, errMsg);
            this.memory.addBotMessage(chatId, errMsg);
            return;
        }

        // Guard: missing or implicit amount for create_payment.
        // If the user's message contains no digit, the LLM likely reused lastPayment
        // amount from context — ask explicitly rather than silently reusing it.
        if (intent.action === "create_payment") {
            const amount = Number(intent.amount);
            const userHasDigit = /\d/.test(text);
            if (!intent.amount || isNaN(amount) || amount <= 0 || !userHasDigit) {
                const token = (intent.token as string) ?? "USDC";
                const beneficiary = intent.beneficiary ? ` to ${String(intent.beneficiary)}` : "";
                const msg = `How much ${token} would you like to send${beneficiary}?`;
                await this.bot.sendMessage(chatId, msg);
                this.memory.addBotMessage(chatId, msg);
                return;
            }
        }

        if (!intent.action) {
            if (intent.message && typeof intent.message === "string") {
                // Guard: suppress fabricated "Confirm/Cancel button" messages when no payment is pending.
                // LLM sometimes hallucinates these instructions after payment-related conversation.
                const flowState = this.memory.getFlowState(chatId);
                const isPaymentPending = flowState?.name === "payment_awaiting_confirmation"
                    || this.memory.getContext(chatId).lastAction === "create_payment";
                const hasFakeButtonRef = /confirm button|cancel button/i.test(intent.message);
                if (hasFakeButtonRef && !isPaymentPending) {
                    logger.warn(null, "[Orchestrator] Suppressed false Confirm/Cancel button message", { chatId });
                    return;
                }
                await this.bot.sendMessage(chatId, intent.message);
                this.memory.addBotMessage(chatId, intent.message);
            }
            return;
        }

        if (this.researchTools.isResearchAction(intent.action)) {
            if (intent.message && typeof intent.message === "string") {
                await this.bot.sendMessage(chatId, intent.message);
                this.memory.addBotMessage(chatId, intent.message);
            }
            await this.handleResearch(chatId, intent, text, auth);
            this.memory.setLastAction(chatId, intent.action!);
            return;
        }

        if (intent.message && typeof intent.message === "string"
            && !Orchestrator.isFabricatedMessage(intent.action, intent.message)) {
            await this.bot.sendMessage(chatId, intent.message);
            this.memory.addBotMessage(chatId, intent.message);
        }

        try {
            const result = await this.dispatchFn(chatId, intent);
            if (intent.action === "create_payment") {
                // Only mark as awaiting confirmation when preparePayment actually showed a card.
                // An empty result means it returned early (vendor not found, bad address, etc.).
                if (result) {
                    this.memory.setFlowState(chatId, { name: "payment_awaiting_confirmation", since: Date.now() });
                }
            } else {
                this.memory.setLastAction(chatId, intent.action!);
            }
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Orchestrator] Dispatch error for action ${intent.action}:`, errMsg);
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

        let resultMsg = formattedData;
        if (synthRaw) {
            try {
                const parsed = JSON.parse(synthRaw) as { message?: string };
                if (parsed.message) resultMsg = parsed.message;
            } catch { /* use fallback */ }
        }

        await this.bot.sendMessage(chatId, resultMsg);
        this.memory.addBotMessage(chatId, resultMsg);
    }
}
