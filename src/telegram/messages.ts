import TelegramBot from "node-telegram-bot-api";
import { logger } from "../utils/logger";
import { VALID_PROVIDERS, DEFAULT_MODELS } from "../llm/constants";
import type { BotDeps } from "./bot";

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
                "<b>ArcPay Agent</b>\n" +
                "AI-powered payment assistant on Arc Network.\n\n" +
                "<b>Get started</b>\n" +
                "• <code>create wallet</code> — set up your wallet\n" +
                "• <code>show wallet</code> — check your balance\n" +
                "• <code>send 5 USDC to alice</code> — make a payment\n\n" +
                "<b>What else you can do</b>\n" +
                "• <code>list vendors</code> — saved contacts\n" +
                "• <code>report</code> — spending overview\n" +
                "• <code>schedule 10 USDC to bob weekly</code> — recurring payments\n" +
                "• <code>BTC price</code> — live crypto prices\n" +
                "• Upload a PDF or image — invoice analysis\n\n" +
                "<b>Testnet USDC</b>\n" +
                "• <code>faucet</code> — get the faucet link\n\n" +
                "<b>Connect your AI</b>\n" +
                "Type one of these to set your key:\n" +
                "• <code>openai sk-...</code>\n" +
                "• <code>anthropic sk-ant-...</code>\n" +
                "• <code>gemini AIza...</code>\n" +
                "• <code>qwen sk-...</code>\n\n" +
                "🐦 <a href=\"https://x.com/ArcPayAgent\">x.com/ArcPayAgent</a>",
                { parse_mode: "HTML", disable_web_page_preview: true }
            );
            return;
        }

        if (msg.text === "/help") {
            await deps.sender.send(chatId,
                "<b>ArcPay — Command Reference</b>\n\n" +
                "<b>💸 Payments</b>\n" +
                "• <code>send 5 USDC to alice</code>\n" +
                "• <code>send 10 EURC to 0x1234...</code>\n" +
                "• <code>request 20 USDC</code> — create a payment link\n\n" +
                "<b>📋 Vendors</b>\n" +
                "• <code>save alice 0x... as vendor</code>\n" +
                "• <code>list my vendors</code>\n" +
                "• <code>remove vendor alice</code>\n\n" +
                "<b>🔄 Schedules</b>\n" +
                "• <code>schedule 10 USDC to alice every week</code>\n" +
                "• <code>list my schedules</code>\n" +
                "• <code>cancel schedule &lt;id&gt;</code>\n\n" +
                "<b>👛 Wallet</b>\n" +
                "• <code>create wallet</code>\n" +
                "• <code>show wallet</code>\n" +
                "• <code>wallet analysis</code>\n\n" +
                "<b>📊 Analytics</b>\n" +
                "• <code>report</code> / <code>account summary</code>\n" +
                "• <code>recent payments</code>\n" +
                "• <code>monthly spending</code>\n\n" +
                "<b>🔍 Research</b>\n" +
                "• <code>BTC price</code>\n" +
                "• <code>1000 EUR in USD</code>\n\n" +
                "<b>🔔 Alerts</b>\n" +
                "• <code>watch my wallet</code>\n" +
                "• <code>alert me when BTC hits $100k</code>\n" +
                "• <code>list my alerts</code>\n\n" +
                "<b>🤖 AI Settings</b>\n" +
                "• <code>openai sk-...</code> — set API key\n" +
                "• <code>/model gpt-4o</code> — change model\n" +
                "• <code>/provider anthropic</code> — change provider\n" +
                "• <code>/aiconfig</code> — show current config\n" +
                "• <code>/removekey</code> — delete API key\n" +
                "• <code>/reset</code> — clear conversation\n\n" +
                "<b>🚰 Other</b>\n" +
                "• <code>faucet</code> — testnet USDC link",
                { parse_mode: "HTML" }
            );
            return;
        }

        if (msg.text === "/reset") {
            deps.memory.reset(chatId);
            await deps.sender.send(chatId, "Conversation reset.");
            return;
        }

        // /model <name> — set LLM model directly, no LLM call needed
        if (msg.text?.startsWith("/model ")) {
            const model = msg.text.slice(7).trim();
            if (model) {
                const ok = await deps.keys.setModel(chatId, model);
                if (ok) await deps.sender.send(chatId, `Model changed to: ${model}`);
                else await deps.sender.send(chatId, "No LLM key configured. Set one first (e.g. openai <key>).");
            }
            return;
        }

        // /provider <name> — set LLM provider directly
        if (msg.text?.startsWith("/provider ")) {
            const provider = msg.text.slice(10).trim().toLowerCase();
            const valid = VALID_PROVIDERS.includes(provider);
            if (!valid) {
                await deps.sender.send(chatId, `Unknown provider. Valid: ${VALID_PROVIDERS.join(", ")}`);
            } else {
                const ok = await deps.keys.setProvider(chatId, provider);
                const models = DEFAULT_MODELS[provider] || [];
                if (ok) await deps.sender.send(chatId, `Provider changed to: ${provider}${models.length ? "\nModels: " + models.slice(0, 3).join(", ") : ""}`);
                else await deps.sender.send(chatId, "No LLM key configured. Set one first.");
            }
            return;
        }

        // /aiconfig — show current AI config
        if (msg.text === "/aiconfig") {
            const info = await deps.keys.getInfo(chatId);
            if (!info) { await deps.sender.send(chatId, "No LLM key configured."); return; }
            const models = DEFAULT_MODELS[info.provider] || [];
            let text = `AI Configuration\n\nProvider: ${info.provider}\nModel: ${info.model || "(default)"}\nKey: configured`;
            if (models.length) text += `\n\nAvailable models:\n${models.map(m => `  ${m}`).join("\n")}`;
            await deps.sender.send(chatId, text);
            return;
        }

        // /removekey — remove LLM key
        if (msg.text === "/removekey") {
            await deps.keys.removeKey(chatId);
            await deps.sender.send(chatId, "LLM API key removed.");
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
