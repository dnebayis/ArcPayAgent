import TelegramBot from "node-telegram-bot-api";
import { logger } from "../utils/logger";
import type { BotDeps } from "./bot";

export const VALID_PROVIDERS = ["openai", "anthropic", "gemini", "groq", "deepseek", "together", "mistral", "openrouter", "qwen"];

export const DEFAULT_MODELS: Record<string, string[]> = {
    openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3-mini"],
    anthropic: ["claude-sonnet-4-20250514", "claude-haiku-4-20250414", "claude-3-5-sonnet-20241022"],
    gemini: ["gemini-2.0-flash", "gemini-2.5-pro-preview-06-05", "gemini-2.5-flash-preview-05-20"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    mistral: ["mistral-small-latest", "mistral-large-latest"],
    openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"],
    qwen: ["qwen-plus", "qwen-turbo", "qwen-max"],
};

export function attachMessageHandlers(bot: TelegramBot, deps: BotDeps): void {
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;

        if (!deps.access.isPermitted(chatId)) return;
        if (!deps.limiter.check(chatId)) {
            await deps.sender.send(chatId, "You're sending messages too quickly. Please wait a moment.");
            return;
        }

        // /start deep links
        if (msg.text?.startsWith("/start pay_")) {
            const requestId = msg.text.replace("/start pay_", "").trim();
            await deps.requestEngine.handleDeepLink(chatId, requestId);
            return;
        }

        if (msg.text === "/start") {
            await deps.sender.send(chatId,
                "ArcPay Agent\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                "AI payment assistant on Arc Network.\n\n" +
                "First steps:\n" +
                "  create wallet     → set up your wallet\n" +
                "  show wallet       → check balance\n" +
                "  send 5 USDC to alice  → make a payment\n\n" +
                "More you can do:\n" +
                "  list vendors      → saved contacts\n" +
                "  report            → spending overview\n" +
                "  schedule payment  → recurring transfers\n" +
                "  BTC price         → live crypto prices\n" +
                "  upload invoice    → PDF/image analysis\n\n" +
                "Testnet USDC faucet:\n" +
                "  https://faucet.circle.com  (select Arc network)\n\n" +
                "AI setup (required for natural language):\n" +
                "  /llmkey openai sk-...     → OpenAI\n" +
                "  /llmkey anthropic sk-ant-...  → Anthropic\n" +
                "  /llmkey gemini AIza...    → Gemini\n\n" +
                "Type /help for all commands.\n\n" +
                "Follow us: x.com/ArcPayAgent"
            );
            return;
        }

        if (msg.text === "/help") {
            await deps.sender.send(chatId,
                "ArcPay — Command Reference\n" +
                "━━━━━━━━━━━━━━━━━━━━\n\n" +
                "AI Configuration\n" +
                "  /llmkey <provider> <key> [model]\n" +
                "  /model <model_name>\n" +
                "  /provider <name>\n" +
                "  /llminfo\n" +
                "  /llmremove\n\n" +
                "Payments\n" +
                "  send 5 USDC to alice\n" +
                "  send 10 EURC to 0x...\n" +
                "  request 20 USDC\n\n" +
                "Vendors\n" +
                "  save vendor alice 0x...\n" +
                "  list vendors\n" +
                "  remove vendor alice\n\n" +
                "Schedules\n" +
                "  schedule 10 USDC to alice weekly\n" +
                "  list schedules\n" +
                "  cancel schedule <id>\n\n" +
                "Analytics\n" +
                "  report / account summary\n" +
                "  recent payments\n" +
                "  monthly spending\n\n" +
                "Research\n" +
                "  BTC price\n" +
                "  1000 EUR in USD\n\n" +
                "Other\n" +
                "  /reset — clear conversation\n" +
                "  watch my wallet\n" +
                "  alert me when BTC hits $100k\n\n" +
                "Providers: " + VALID_PROVIDERS.join(", ")
            );
            return;
        }

        if (msg.text?.startsWith("/llmkey")) {
            await handleLLMKey(chatId, msg.text, deps);
            return;
        }

        if (msg.text?.startsWith("/model")) {
            await handleModelChange(chatId, msg.text, deps);
            return;
        }

        if (msg.text?.startsWith("/provider")) {
            await handleProviderChange(chatId, msg.text, deps);
            return;
        }

        if (msg.text === "/llminfo") {
            await handleLLMInfo(chatId, deps);
            return;
        }

        if (msg.text === "/llmremove") {
            await deps.keys.removeKey(chatId);
            await deps.sender.send(chatId, "LLM API key removed.");
            return;
        }

        if (msg.text === "/reset") {
            deps.memory.reset(chatId);
            await deps.sender.send(chatId, "Conversation reset.");
            return;
        }

        if (msg.text === "/watch_payments_enable" || msg.text === "/watch") {
            await deps.orchestrator.handleMessage(chatId, "enable payment notifications");
            return;
        }

        if (msg.text === "/watch_payments_disable") {
            await deps.orchestrator.handleMessage(chatId, "disable payment notifications");
            return;
        }

        if (msg.text) {
            await deps.orchestrator.handleMessage(chatId, msg.text);
        }

        if (msg.document || msg.photo) {
            await handleDocument(bot, chatId, msg, deps);
        }
    });
}

async function handleLLMKey(chatId: number, text: string, deps: BotDeps): Promise<void> {
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
        await deps.sender.send(chatId,
            "Usage: /llmkey <provider> <api_key> [model]\n\n" +
            "Providers: " + VALID_PROVIDERS.join(", ") + "\n\n" +
            "Example:\n" +
            "  /llmkey openai sk-...\n" +
            "  /llmkey anthropic sk-ant-... claude-sonnet-4-20250514\n" +
            "  /llmkey gemini AIza..."
        );
        return;
    }

    const provider = parts[1].toLowerCase();
    const key = parts[2];
    const model = parts[3] || undefined;

    if (!VALID_PROVIDERS.includes(provider)) {
        await deps.sender.send(chatId, `Unknown provider "${provider}".\n\nValid providers: ${VALID_PROVIDERS.join(", ")}`);
        return;
    }

    await deps.keys.setKey(chatId, provider, key, model);

    let reply = `LLM configured: ${provider}`;
    if (model) reply += ` (model: ${model})`;
    reply += "\nYour key is stored encrypted.";

    const models = DEFAULT_MODELS[provider];
    if (models && !model) {
        reply += `\n\nDefault model will be used. Change anytime with:\n/model <name>\n\nAvailable: ${models.join(", ")}`;
    }

    await deps.sender.send(chatId, reply);
}

async function handleModelChange(chatId: number, text: string, deps: BotDeps): Promise<void> {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
        const info = await deps.keys.getInfo(chatId);
        if (!info) {
            await deps.sender.send(chatId, "No LLM key configured. Use /llmkey first.");
            return;
        }
        const models = DEFAULT_MODELS[info.provider] || [];
        await deps.sender.send(chatId,
            `Usage: /model <model_name>\n\n` +
            `Current provider: ${info.provider}\n` +
            `Current model: ${info.model || "(default)"}\n\n` +
            (models.length > 0 ? `Available models for ${info.provider}:\n${models.map(m => `  ${m}`).join("\n")}` : "")
        );
        return;
    }

    const model = parts[1];
    const success = await deps.keys.setModel(chatId, model);
    if (!success) {
        await deps.sender.send(chatId, "No LLM key configured. Use /llmkey first.");
        return;
    }
    await deps.sender.send(chatId, `Model changed to: ${model}`);
}

async function handleProviderChange(chatId: number, text: string, deps: BotDeps): Promise<void> {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
        const info = await deps.keys.getInfo(chatId);
        await deps.sender.send(chatId,
            `Usage: /provider <name>\n\n` +
            `Current: ${info?.provider || "not set"}\n` +
            `Available: ${VALID_PROVIDERS.join(", ")}\n\n` +
            `Note: Switching provider keeps your API key. If the new provider needs a different key, use /llmkey instead.`
        );
        return;
    }

    const provider = parts[1].toLowerCase();
    if (!VALID_PROVIDERS.includes(provider)) {
        await deps.sender.send(chatId, `Unknown provider "${provider}".\n\nValid: ${VALID_PROVIDERS.join(", ")}`);
        return;
    }

    const success = await deps.keys.setProvider(chatId, provider);
    if (!success) {
        await deps.sender.send(chatId, "No LLM key configured. Use /llmkey first.");
        return;
    }

    const models = DEFAULT_MODELS[provider] || [];
    let reply = `Provider changed to: ${provider}`;
    if (models.length > 0) {
        reply += `\n\nDefault model will be used. Available:\n${models.map(m => `  ${m}`).join("\n")}\n\nChange with: /model <name>`;
    }
    await deps.sender.send(chatId, reply);
}

async function handleLLMInfo(chatId: number, deps: BotDeps): Promise<void> {
    const info = await deps.keys.getInfo(chatId);
    if (!info) {
        await deps.sender.send(chatId, "No LLM configuration found.\n\nSet up with: /llmkey <provider> <api_key> [model]");
        return;
    }

    const models = DEFAULT_MODELS[info.provider] || [];
    let text = `LLM Configuration\n\n`;
    text += `Provider: ${info.provider}\n`;
    text += `Model: ${info.model || "(default)"}\n`;
    text += `Key: ****configured****\n`;

    if (models.length > 0) {
        text += `\nAvailable models for ${info.provider}:\n${models.map(m => `  ${m}`).join("\n")}`;
    }

    text += `\n\nCommands:\n  /model <name> — Change model\n  /provider <name> — Switch provider\n  /llmremove — Remove key`;

    await deps.sender.send(chatId, text);
}

export async function handleDocument(bot: TelegramBot, chatId: number, msg: TelegramBot.Message, deps: BotDeps): Promise<void> {
    let fileId: string | undefined;
    let mimeType = "application/octet-stream";

    if (msg.document) {
        fileId = msg.document.file_id;
        mimeType = msg.document.mime_type || mimeType;
    } else if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1]?.file_id;
        mimeType = "image/jpeg";
    }

    if (!fileId) return;

    if (!mimeType.startsWith("image/") && mimeType !== "application/pdf" && !mimeType.includes("octet-stream")) {
        await deps.sender.send(chatId, "Please upload a PDF or image file for invoice analysis.");
        return;
    }

    try {
        const fileLink = await bot.getFileLink(fileId);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch(fileLink, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
            await deps.sender.send(chatId, "Failed to download the file. Please try again.");
            return;
        }

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 10) {
            await deps.sender.send(chatId, "The file seems empty or too small to analyze.");
            return;
        }

        await deps.sender.send(chatId, "Processing document...");

        const { extractText } = await import("../utils/parser");
        const text = await extractText(buffer, mimeType);

        if (!text || text.length < 20) {
            await deps.sender.send(chatId, "Could not extract readable text from the document. Please try a clearer scan.");
            return;
        }

        await deps.invoiceEngine.analyze(chatId, text, msg.message_id);
    } catch (err: any) {
        logger.error(chatId, "[Bot] Document handling error", { error: err.message });
        if (err.message?.includes("abort")) {
            await deps.sender.send(chatId, "File download timed out. Please try again.");
        } else if (err.message?.includes("Unsupported")) {
            await deps.sender.send(chatId, "Unsupported file type. Please upload a PDF or image.");
        } else {
            await deps.sender.send(chatId, "Failed to process the document. Please try a different file.");
        }
    }
}
