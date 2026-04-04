import { logger } from "../utils/logger";
import { requestToolCompletion, type LLMAuth } from "../llm/client";
import { buildSystemPrompt } from "../llm/prompt";
import { TERMINAL_ACTIONS } from "../llm/tools";
import { VALID_PROVIDERS } from "../llm/constants";
import { executeAction, hasAction } from "../actions/registry";
import type { ConversationMemory } from "../memory/conversation";
import type { FlowStateManager } from "./state";
import type { Sender } from "./sender";
import type { LLMKeyStore } from "../store/keys";
import { getConfig } from "../config";

/**
 * Actions where the LLM's pre-tool message is NEVER sent to Telegram.
 * The engine/action handler is the sole sender.
 * This makes the button-disappearing bug structurally impossible.
 */
const SILENT_ACTIONS = new Set([
    "create_payment",
    "list_vendors", "show_wallet", "monthly_spending",
    "show_recent_payments", "report", "spending_by_vendor",
    "list_schedules", "top_vendors", "list_price_alerts",
    "account_summary", "vendor_detail", "wallet_intelligence",
    "agent_status", "agent_identity", "agent_validation_status",
    "watch_payments_status", "status", "create_wallet", "export_wallet",
    "schedule_payment", "cancel_schedule", "cancel_all_schedules",
    "set_price_alert", "remove_price_alert", "remove_all_price_alerts",
    "watch_payments_enable", "watch_payments_disable",
    "get_crypto_prices", "get_fx_rate", "get_arc_network_stats", "get_my_arc_activity",
    "create_payment_request", "analyze_invoice",
    "remove_vendor", "remove_all_vendors", "save_vendor",
    "set_model", "set_provider", "show_ai_config", "remove_ai_key", "reset_conversation",
]);

const CONFIRMATION_PHRASES = new Set([
    "yes", "confirm", "ok", "go", "proceed", "send", "send it", "do it",
    "sure", "yep", "yeah", "absolutely", "approve",
]);

const CANCEL_PHRASES = new Set([
    "no", "cancel", "stop", "abort", "nevermind", "nope", "nah", "reject",
]);

export class Orchestrator {
    private memory: ConversationMemory;
    private flowState: FlowStateManager;
    private sender: Sender;
    private keys: LLMKeyStore;

    constructor(
        memory: ConversationMemory,
        flowState: FlowStateManager,
        sender: Sender,
        keys: LLMKeyStore,
    ) {
        this.memory = memory;
        this.flowState = flowState;
        this.sender = sender;
        this.keys = keys;
    }

    async handleMessage(chatId: number, text: string): Promise<void> {
        // Load persisted context on first message after restart (no-op if already loaded)
        await this.memory.load(chatId);
        this.memory.addUserMessage(chatId, text);

        // Rule 1 & 2: If awaiting confirmation, intercept confirm/cancel text
        if (this.flowState.isAwaitingConfirmation(chatId)) {
            const lower = text.toLowerCase().trim();
            if (CONFIRMATION_PHRASES.has(lower)) {
                await this.sender.send(chatId, "Please use the Confirm button above to complete the payment.");
                return;
            }
            if (CANCEL_PHRASES.has(lower)) {
                await this.sender.send(chatId, "Please use the Cancel button above to cancel this payment.");
                return;
            }
            // Any other message while awaiting confirmation — still redirect
            // Let it go to LLM but LLM prompt also enforces this
        }

        // Rule 11: Bare number after "how much?" → amount for pending action
        if (this.flowState.isAwaitingAmount(chatId)) {
            const num = parseFloat(text.trim());
            if (!isNaN(num) && num > 0) {
                const state = this.flowState.get(chatId);
                this.flowState.clear(chatId);
                // Execute create_payment with the amount
                await executeAction(chatId, "create_payment", {
                    beneficiary: state.beneficiary || "",
                    amount: num,
                    token: state.token || "USDC",
                });
                return;
            }
        }

        // Get LLM auth — if absent, try keyword fallback before blocking
        const auth = await this.getLLMAuth(chatId);
        if (!auth) {
            if (await this.tryKeywordFallback(chatId, text)) return;
            await this.sender.send(chatId,
                "No AI key configured. To get started, type:\n\n" +
                "  openai <your-key>\n" +
                "  anthropic <your-key>\n" +
                "  gemini <your-key>\n" +
                "  qwen <your-key>\n\n" +
                "Basic commands work without a key:\n" +
                "  wallet — show balance\n" +
                "  create wallet — set up wallet\n" +
                "  vendors — saved contacts\n" +
                "  schedules — active schedules\n" +
                "  report — spending report\n" +
                "  faucet — get testnet USDC\n\n" +
                "If you already set a key and see this, the server restarted. Just type your key again."
            );
            return;
        }

        // Build messages for LLM
        const contextSummary = this.memory.buildContextSummary(chatId);
        const systemPrompt = buildSystemPrompt(contextSummary);
        const history = this.memory.getHistory(chatId);

        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
        ];

        const config = getConfig();
        const maxIterations = config.MAX_AGENT_ITERATIONS;

        // Agent loop: LLM may chain tool calls
        for (let i = 0; i < maxIterations; i++) {
            try {
                const response = await requestToolCompletion(auth, messages);

                if (response.finishReason === "tool_calls" && response.toolName) {
                    const toolName = response.toolName;
                    const toolArgs = response.toolArgs;

                    logger.info(chatId, "[Orchestrator] Tool call", { tool: toolName, args: toolArgs, iteration: i });

                    if (SILENT_ACTIONS.has(toolName)) {
                        // NEVER send LLM message — engine/action is the sole sender
                        await executeAction(chatId, toolName, toolArgs);
                    } else {
                        // Send LLM message first (if any), then dispatch
                        if (response.message) {
                            await this.sender.send(chatId, response.message);
                        }
                        if (hasAction(toolName)) {
                            await executeAction(chatId, toolName, toolArgs);
                        }
                    }

                    // Update last action
                    this.memory.setLastAction(chatId, toolName);

                    // Terminal action → stop loop
                    if (TERMINAL_ACTIONS.has(toolName)) break;
                } else {
                    // No tool call — just send the message
                    if (response.message) {
                        await this.sender.send(chatId, response.message);
                    }
                    break;
                }
            } catch (err: any) {
                logger.error(chatId, "[Orchestrator] LLM error", { error: err.message, iteration: i });
                const hint = err.message?.includes("401") ? " (check your API key)"
                    : err.message?.includes("429") ? " (rate limited)"
                    : err.message?.includes("404") ? " (model not found — try: /model <name>)"
                    : err.message?.includes("abort") ? " (request timed out)"
                    : "";
                await this.sender.send(chatId, `LLM error${hint}. Try again or use /model to change the model.`);
                break;
            }
        }
    }

    /**
     * Match simple commands when no LLM key is set.
     * Returns true if a fallback action was dispatched.
     */
    private async tryKeywordFallback(chatId: number, text: string): Promise<boolean> {
        const t = text.toLowerCase().trim();

        // LLM key setup: "openai sk-...", "set my openai key sk-...", "anthropic key sk-ant-..."
        // Also handle legacy "/llmkey openai sk-..." format
        const keyMatch = t.match(
            /^(?:\/llmkey\s+|(?:set\s+)?(?:my\s+)?(?:llm\s+)?(?:api\s+)?key\s+)?([a-z]+)\s+(?:key\s+)?([A-Za-z0-9_\-\.]+)$/
        );
        if (keyMatch) {
            const [, provider, key] = keyMatch;
            if (VALID_PROVIDERS.includes(provider) && key.length > 8) {
                await this.keys.setKey(chatId, provider, key);
                await this.sender.send(chatId,
                    `LLM configured: ${provider}\nYour key is stored encrypted.\n\nYou can now use natural language to interact with ArcPay.`
                );
                return true;
            }
        }

        // model <name> / set model <name> — works without LLM key too
        const modelMatch = t.match(/^(?:set\s+)?model\s+(\S+)$/);
        if (modelMatch) {
            const model = modelMatch[1];
            const ok = await this.keys.setModel(chatId, model);
            if (ok) { await this.sender.send(chatId, `Model changed to: ${model}`); return true; }
            // No key — fall through to show the no-key message
        }

        // provider <name> / set provider <name>
        const providerMatch = t.match(/^(?:set\s+)?(?:change\s+)?provider\s+(?:to\s+)?(\S+)$/);
        if (providerMatch) {
            const provider = providerMatch[1].toLowerCase();
            if (VALID_PROVIDERS.includes(provider)) {
                const ok = await this.keys.setProvider(chatId, provider);
                if (ok) { await this.sender.send(chatId, `Provider changed to: ${provider}`); return true; }
            }
        }

        const match = (patterns: string[]): boolean => patterns.some(p => t.includes(p));

        if (match(["create wallet", "new wallet", "make wallet"])) {
            await executeAction(chatId, "create_wallet", {});
            return true;
        }
        if (match(["show wallet", "wallet balance", "my balance", "my wallet", "balance", "wallet"])) {
            await executeAction(chatId, "show_wallet", {});
            return true;
        }
        if (match(["list vendor", "my vendor", "show vendor", "vendors"])) {
            await executeAction(chatId, "list_vendors", {});
            return true;
        }
        if (match(["list schedule", "my schedule", "show schedule", "schedules"])) {
            await executeAction(chatId, "list_schedules", {});
            return true;
        }
        if (match(["account summary", "account status", "summary"])) {
            await executeAction(chatId, "account_summary", {});
            return true;
        }
        if (match(["recent payment", "payment history", "last payment"])) {
            await executeAction(chatId, "show_recent_payments", {});
            return true;
        }
        if (match(["report", "spending"])) {
            await executeAction(chatId, "report", { period: "monthly" });
            return true;
        }
        if (match(["price alert", "my alert", "list alert"])) {
            await executeAction(chatId, "list_price_alerts", {});
            return true;
        }
        if (match(["faucet", "get usdc", "get testnet", "test usdc"])) {
            await this.sender.send(chatId,
                "Testnet USDC Faucet\n\n" +
                "https://faucet.circle.com\n\n" +
                "Select \"Arc\" network, paste your wallet address, and request USDC."
            );
            return true;
        }

        return false;
    }

    async getLLMAuth(chatId: number): Promise<LLMAuth | null> {
        return this.keys.getAuth(chatId);
    }
}
