import { registerAction } from "./registry";
import type { LLMKeyStore } from "../store/keys";
import type { ConversationMemory } from "../memory/conversation";

const VALID_PROVIDERS = ["openai", "anthropic", "gemini", "groq", "deepseek", "together", "mistral", "openrouter", "qwen"];

const DEFAULT_MODELS: Record<string, string[]> = {
    openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini"],
    anthropic: ["claude-sonnet-4-20250514", "claude-haiku-4-20250414"],
    gemini: ["gemini-2.0-flash", "gemini-2.5-pro-preview-06-05"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    mistral: ["mistral-small-latest", "mistral-large-latest"],
    openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"],
    qwen: ["qwen-plus", "qwen-turbo", "qwen-max"],
};

export interface ConfigActionDeps {
    keys: LLMKeyStore;
    memory: ConversationMemory;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerConfigActions(deps: ConfigActionDeps): void {
    registerAction("set_model", async (chatId, params) => {
        const { model } = params;
        if (!model) {
            await deps.send(chatId, "Please specify a model name.");
            return;
        }
        const success = await deps.keys.setModel(chatId, String(model));
        if (!success) {
            await deps.send(chatId, "No LLM key configured. Set one first.");
            return;
        }
        await deps.send(chatId, `Model changed to: ${model}`);
    });

    registerAction("set_provider", async (chatId, params) => {
        const provider = String(params.provider || "").toLowerCase();
        if (!VALID_PROVIDERS.includes(provider)) {
            await deps.send(chatId, `Unknown provider. Valid: ${VALID_PROVIDERS.join(", ")}`);
            return;
        }
        const success = await deps.keys.setProvider(chatId, provider);
        if (!success) {
            await deps.send(chatId, "No LLM key configured. Set one first.");
            return;
        }
        const models = DEFAULT_MODELS[provider] || [];
        let reply = `Provider changed to: ${provider}`;
        if (models.length > 0) reply += `\nAvailable models: ${models.slice(0, 3).join(", ")}`;
        await deps.send(chatId, reply);
    });

    registerAction("show_ai_config", async (chatId) => {
        const info = await deps.keys.getInfo(chatId);
        if (!info) {
            await deps.send(chatId, "No LLM key configured.");
            return;
        }
        const models = DEFAULT_MODELS[info.provider] || [];
        let text = `AI Configuration\n\nProvider: ${info.provider}\nModel: ${info.model || "(default)"}\nKey: configured`;
        if (models.length > 0) text += `\n\nAvailable models:\n${models.map(m => `  ${m}`).join("\n")}`;
        await deps.send(chatId, text);
    });

    registerAction("remove_ai_key", async (chatId) => {
        await deps.keys.removeKey(chatId);
        await deps.send(chatId, "LLM API key removed.");
    });

    registerAction("reset_conversation", async (chatId) => {
        deps.memory.reset(chatId);
        await deps.send(chatId, "Conversation reset.");
    });
}
