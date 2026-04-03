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
                "  create wallet       → set up your wallet\n" +
                "  show wallet         → check balance\n" +
                "  send 5 USDC to alice  → make a payment\n\n" +
                "More you can do:\n" +
                "  list vendors        → saved contacts\n" +
                "  report              → spending overview\n" +
                "  schedule payment    → recurring transfers\n" +
                "  BTC price           → live crypto prices\n" +
                "  upload invoice      → PDF/image analysis\n\n" +
                "Testnet USDC:\n" +
                "  faucet              → get faucet link\n\n" +
                "AI setup — just type one of these:\n" +
                "  openai <your-key>\n" +
                "  anthropic <your-key>\n" +
                "  gemini <your-key>\n\n" +
                "Follow us: x.com/ArcPayAgent"
            );
            return;
        }

        if (msg.text === "/help") {
            await deps.sender.send(chatId,
                "ArcPay — What can I do?\n" +
                "━━━━━━━━━━━━━━━━━━━━\n\n" +
                "Payments\n" +
                "  send 5 USDC to alice\n" +
                "  send 10 EURC to 0x...\n" +
                "  request 20 USDC from someone\n\n" +
                "Vendors\n" +
                "  save alice 0x... as vendor\n" +
                "  list my vendors\n" +
                "  remove vendor alice\n\n" +
                "Schedules\n" +
                "  schedule 10 USDC to alice every week\n" +
                "  list my schedules\n" +
                "  cancel schedule <id>\n\n" +
                "Wallet\n" +
                "  create wallet\n" +
                "  show wallet\n" +
                "  wallet analysis\n\n" +
                "Analytics\n" +
                "  report / account summary\n" +
                "  recent payments\n" +
                "  monthly spending\n\n" +
                "Research\n" +
                "  BTC price\n" +
                "  1000 EUR in USD\n\n" +
                "Alerts\n" +
                "  watch my wallet\n" +
                "  alert me when BTC hits $100k\n" +
                "  list my alerts\n\n" +
                "AI Settings\n" +
                "  openai <key>         → set key\n" +
                "  what model am I using\n" +
                "  change model to gpt-4o\n" +
                "  change provider to anthropic\n" +
                "  remove my ai key\n" +
                "  reset conversation\n\n" +
                "Other\n" +
                "  faucet               → testnet USDC link"
            );
            return;
        }

        if (msg.text === "/reset") {
            deps.memory.reset(chatId);
            await deps.sender.send(chatId, "Conversation reset.");
            return;
        }

        // Text messages → orchestrator handles all natural language
        if (msg.text) {
            await deps.orchestrator.handleMessage(chatId, msg.text);
        }

        // Document/photo → invoice analysis
        if (msg.document || msg.photo) {
            await handleDocument(bot, chatId, msg, deps);
        }
    });
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
