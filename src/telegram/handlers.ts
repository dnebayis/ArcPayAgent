import TelegramBot from "node-telegram-bot-api";
import { WalletStore } from "../storage/walletStore";
import { PaymentEngine } from "../engines/paymentEngine";
import { InvoiceEngine, InvoiceSessionRecord } from "../engines/invoiceEngine";
import { PaymentRequestEngine } from "../engines/paymentRequestEngine";
import { ConversationMemory } from "../agent/conversationMemory";
import { ScheduleStore } from "../storage/schedules";
import { UserPreferencesStore } from "../storage/userPreferences";
import { Orchestrator } from "../core/orchestrator";
import { RateLimiter } from "../middleware/rateLimiter";
import { AccessControl } from "../middleware/accessControl";
import { logger } from "../utils/logger";

/**
 * Builds the message to send to the orchestrator after a silent invoice analysis.
 * Incorporates the user's caption (if any) or generates a natural prompt.
 */
function buildInvoiceOrchestratorMessage(
    result: { session: InvoiceSessionRecord; error: null } | { session: null; error: string },
    caption?: string
): string {
    if (result.session === null) {
        const base = "I uploaded a document but couldn't extract invoice details from it.";
        return caption ? `${base} The user also asked: "${caption}"` : base;
    }

    const { invoice, risk, resolution } = result.session;
    const vendor = invoice.vendor || "Unknown Vendor";
    const detected = invoice.detectedAmount && invoice.detectedCurrency
        ? `${invoice.detectedAmount} ${invoice.detectedCurrency}`
        : null;
    const settlement = invoice.settlementAmount
        ? `${invoice.settlementAmount} ${invoice.settlementCurrency || "USDC"}`
        : null;
    const riskLabel = risk ? `risk=${risk.level.toLowerCase()}` : "risk=unknown";
    const flags = risk?.flags?.length ? ` (${risk.flags.join(", ")})` : "";
    const invNum = invoice.invoiceNumber ? `, invoice #${invoice.invoiceNumber}` : "";
    const date = invoice.date ? `, date: ${invoice.date}` : "";
    const vendorSaved = resolution.canPreparePayment ? ", vendor is saved" : ", vendor not saved yet";

    const context = `[Invoice analyzed: vendor=${vendor}, detected=${detected || "unknown"}, settlement=${settlement || "unknown"}, ${riskLabel}${flags}${invNum}${date}${vendorSaved}]`;

    if (caption) {
        return `${context} ${caption}`;
    }

    return `${context} I just uploaded an invoice. Please analyze it and let me know if it looks safe to pay.`;
}

const HELP_MESSAGE = `📖 *Arc Pay Agent — Guide*

*Wallet*
\`create wallet\` · \`show wallet\` · \`wallet balance\`

*Payments*
\`send 5 usdc to aws\` · \`send 5 usdc to 0x...\`
\`request 20 usdc\` · \`payment history\`

*Vendors*
\`save vendor aws 0x...\` · \`list vendors\`
\`vendor aws\` · \`remove vendor aws\`

*Invoices*
Send a PDF or photo — I'll analyze it and guide you through payment.

*Schedules*
\`schedule 10 usdc to aws tomorrow\`
\`list schedules\` · \`cancel schedule <id>\`

*Reports*
\`report\` · \`account summary\` · \`spending by vendor\`

*LLM Key*
\`/llmkey set openai sk-...\`
\`/llmkey status\` · \`/llmkey model gpt-4o-mini\` · \`/llmkey remove\`

You can also just describe what you want in plain language — no commands required.
Follow us on X: @ArcPayAgent`;

export function setupHandlers(
    bot: TelegramBot,
    walletStore: WalletStore,
    llmKeyStore: any,
    orchestrator: Orchestrator,
    paymentEngine?: PaymentEngine,
    invoiceEngine?: InvoiceEngine,
    paymentRequestEngine?: PaymentRequestEngine,
    conversationMemory?: ConversationMemory,
    scheduleStore?: ScheduleStore,
    userPreferencesStore?: UserPreferencesStore,
    accessControl?: AccessControl,
    rateLimiter?: RateLimiter
) {
    bot.setMyCommands([
        { command: "start", description: "Open the Arc Pay Agent quick start guide" },
        { command: "help", description: "Show the full command guide" },
        { command: "reset", description: "Clear your conversation context" }
    ]).catch((error) => {
        console.warn("[Telegram] Failed to register bot commands:", error);
    });

    /** Shared auth + rate-limit gate used by both message and callback handlers. */
    const isPermitted = (chatId: number): boolean => {
        if (accessControl && !accessControl.isAllowed(chatId)) {
            bot.sendMessage(chatId, "⛔ This bot is in private mode. You don't have access.").catch(() => {});
            return false;
        }
        if (rateLimiter && !rateLimiter.allow(chatId)) {
            bot.sendMessage(chatId, "⏳ You're sending messages too fast — please slow down.").catch(() => {});
            return false;
        }
        return true;
    };

    const handleTextTurn = async (chatId: number, originalText: string): Promise<void> => {
        if (!isPermitted(chatId)) return;

        const text = originalText.toLowerCase().trim();

        if (!text) return;
        if (!/[a-z0-9]/i.test(originalText)) return;

        // /start deep link (payment request)
        const startMatch = originalText.match(/^\/start\s+req_(.+)/i);
        if (startMatch && paymentRequestEngine) {
            paymentRequestEngine.handleDeepLink(chatId, startMatch[1]);
            return;
        }

        // /start welcome
        if (text === "/start") {
            const startMessage = `👋 *Welcome to Arc Pay Agent*

I help you manage USDC payments, invoices, vendors, and schedules on Arc — just talk to me naturally.

*Quick start*
\`create wallet\` · \`show wallet\`
\`save vendor aws 0x...\` · \`send 5 usdc to aws\`
Send a PDF or photo invoice to analyze and pay it

*Set your LLM key to get started*
\`/llmkey set openai sk-...\`

Type \`/help\` for the full guide.
Follow us: @ArcPayAgent`;
            bot.sendMessage(chatId, startMessage, { parse_mode: "Markdown" });
            return;
        }

        // /help
        if (text === "/help" || /^help[!?\.]*$/i.test(originalText.trim())) {
            bot.sendMessage(chatId, HELP_MESSAGE, { parse_mode: "Markdown" });
            return;
        }

        // /reset — clears full conversation context
        if (text === "/reset") {
            conversationMemory?.clearContext(chatId);
            bot.sendMessage(chatId, "🔄 Conversation context cleared. Starting fresh!");
            return;
        }

        // /health and /ready info
        if (text === "/health" || text === "/ready") {
            const endpoint = text === "/health" ? "/health" : "/ready";
            bot.sendMessage(
                chatId,
                `\`${endpoint}\` is an HTTP endpoint, not a Telegram command.\n\nUse it in your browser or with curl against your deployed service URL.\n\nExample:\n\`https://your-service.onrender.com${endpoint}\``,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // /llmkey
        const llmKeyMatch = originalText.match(/^\/llmkey(?:\s+(.+))?$/i);
        if (llmKeyMatch) {
            const rawArgs = llmKeyMatch[1]?.trim() || "";
            const [subcommandRaw, ...rest] = rawArgs.split(/\s+/).filter(Boolean);
            const subcommand = (subcommandRaw || "status").toLowerCase();

            if (subcommand === "status") {
                bot.sendMessage(chatId, `🔐 ${llmKeyStore.getStatus(chatId)}`);
                return;
            }
            if (subcommand === "remove") {
                const removed = llmKeyStore.removeKey(chatId);
                bot.sendMessage(chatId, removed ? "✅ Your saved LLM key was removed." : "No saved LLM key was found for this account.");
                return;
            }
            if (subcommand === "model") {
                const model = rest.join(" ").trim();
                if (!model) {
                    bot.sendMessage(chatId, "Usage: `/llmkey model gpt-4.1-mini`", { parse_mode: "Markdown" });
                    return;
                }
                const updated = llmKeyStore.setModel(chatId, model);
                bot.sendMessage(chatId, updated ? `✅ Preferred LLM model set to \`${model}\`.` : "Set your LLM key first with `/llmkey set <provider> <api-key>`.", { parse_mode: "Markdown" });
                return;
            }
            if (subcommand === "set") {
                const provider = rest[0]?.toLowerCase();
                const apiKey = rest.slice(1).join(" ").trim();
                if (!provider || !apiKey) {
                    bot.sendMessage(chatId, "Usage: `/llmkey set openai sk-...`", { parse_mode: "Markdown" });
                    return;
                }
                llmKeyStore.setKey(chatId, provider, apiKey);
                bot.sendMessage(chatId, `✅ Saved your LLM key for provider \`${provider}\`.`, { parse_mode: "Markdown" });
                return;
            }

            bot.sendMessage(
                chatId,
                "Use one of these commands:\n• `/llmkey status`\n• `/llmkey set openai sk-...`\n• `/llmkey model gpt-4.1-mini`\n• `/llmkey remove`",
                { parse_mode: "Markdown" }
            );
            return;
        }

        // All other text → orchestrator
        try {
            await orchestrator.handleMessage(chatId, originalText);
        } catch (error) {
            console.error("[handlers] Orchestrator error:", error);
            bot.sendMessage(chatId, "Something went wrong. Please try again.");
        }
    };

    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;

        if (msg.from?.language_code) {
            if (userPreferencesStore) userPreferencesStore.setLocaleIfMissing(chatId, msg.from.language_code);
            conversationMemory?.setLanguage(chatId, msg.from.language_code);
        }

        // PDF invoice upload
        if (msg.document && invoiceEngine) {
            const doc = msg.document;
            if (doc.mime_type === "application/pdf") {
                try {
                    bot.sendMessage(chatId, "📄 Analyzing invoice...");
                    const fileLink = await bot.getFileLink(doc.file_id);
                    const response = await fetch(fileLink);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const extracted = await invoiceEngine.analyzeInvoice(buffer, "application/pdf");
                    const result = await invoiceEngine.processInvoiceSilent(chatId, extracted, {
                        sourceMessageId: msg.message_id,
                        sourceMimeType: "application/pdf"
                    });
                    if (result.session === null) {
                        bot.sendMessage(chatId, "❌ I couldn't extract invoice details from this document. Make sure it's a text-based PDF (not scanned), or try sending a clearer photo.");
                        return;
                    }
                    invoiceEngine.sendInvoiceSummary(chatId, result.session);
                    const caption = msg.caption?.trim();
                    if (caption) {
                        const orchestratorMsg = buildInvoiceOrchestratorMessage(result, caption);
                        await handleTextTurn(chatId, orchestratorMsg);
                    }
                } catch (err: any) {
                    bot.sendMessage(chatId, `❌ Failed to process PDF: ${err.message}`);
                }
                return;
            }
        }

        // Photo invoice upload (OCR)
        if (msg.photo && msg.photo.length > 0 && invoiceEngine) {
            try {
                bot.sendMessage(chatId, "🖼️ Analyzing invoice image...");
                const photo = msg.photo[msg.photo.length - 1];
                const fileLink = await bot.getFileLink(photo.file_id);
                const response = await fetch(fileLink);
                const buffer = Buffer.from(await response.arrayBuffer());
                const extracted = await invoiceEngine.analyzeInvoice(buffer, "image/png");
                const result = await invoiceEngine.processInvoiceSilent(chatId, extracted, {
                    sourceMessageId: msg.message_id,
                    sourceMimeType: "image/png"
                });
                if (result.session === null) {
                    bot.sendMessage(chatId, "❌ I couldn't extract invoice details from this image. Try sending a clearer photo or a text-based PDF.");
                    return;
                }
                invoiceEngine.sendInvoiceSummary(chatId, result.session);
                const caption = msg.caption?.trim();
                if (caption) {
                    const orchestratorMsg = buildInvoiceOrchestratorMessage(result, caption);
                    await handleTextTurn(chatId, orchestratorMsg);
                }
            } catch (err: any) {
                bot.sendMessage(chatId, `❌ Failed to process image: ${err.message}`);
            }
            return;
        }

        // Text message
        const originalText = msg.text?.trim() || "";
        await handleTextTurn(chatId, originalText);
    });

    bot.on("callback_query", async (query) => {
        const data = query.data;
        if (!data || !query.message) return;
        const chatId = query.message.chat.id;
        const senderId = query.from?.id;

        if (!senderId) {
            await bot.answerCallbackQuery(query.id, { text: "Unable to verify user." });
            return;
        }

        if (!isPermitted(senderId)) {
            await bot.answerCallbackQuery(query.id, { text: "Access denied." });
            return;
        }

        const rejectUnauthorized = () => bot.answerCallbackQuery(query.id, {
            text: "This action is not available for your account."
        });

        // Invoice: pay
        if (data.startsWith("invpay_") && invoiceEngine && paymentEngine) {
            const ownerChatId = parseInt(data.replace("invpay_", ""), 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }

            const session = invoiceEngine.getActiveSession(ownerChatId);
            if (!session || !session.invoice.amount || !session.invoice.vendor) {
                bot.answerCallbackQuery(query.id, { text: "Invoice session expired. Please resend the invoice." });
                return;
            }

            if (session.risk?.blocked) {
                await bot.answerCallbackQuery(query.id, { text: "This invoice is blocked due to high risk." });
                return;
            }

            if (session.risk?.requiresOverride || session.status === "review_required" || session.status === "awaiting_override") {
                await bot.answerCallbackQuery(query.id, {
                    text: "Review required first. Say 'pay it anyway' if you want to continue."
                });
                await bot.sendMessage(ownerChatId, "This invoice still needs review before I prepare a payment. If you've reviewed the flags and want to continue, say `pay it anyway`.", {
                    parse_mode: "Markdown"
                });
                return;
            }

            if (!session.resolution.canPreparePayment) {
                await bot.answerCallbackQuery(query.id, { text: "Save the vendor with a wallet address first." });
                await bot.sendMessage(ownerChatId, `Save vendor "${session.invoice.vendor}" with a wallet address first, then I can prepare this invoice payment automatically.`);
                return;
            }

            invoiceEngine.storeInvoice(ownerChatId, session.invoice);
            await bot.editMessageText("Preparing payment from invoice...", {
                chat_id: chatId,
                message_id: query.message.message_id
            }).catch(() => { });

            invoiceEngine.markSessionAwaitingPaymentConfirmation(ownerChatId, session.id);
            const beneficiary = session.resolution.matchedVendorName || session.invoice.vendor;
            try {
                await paymentEngine.preparePayment(ownerChatId, beneficiary, session.invoice.amount, `Invoice ${session.invoice.invoiceNumber || "N/A"}`, {
                    source: {
                        type: "invoice",
                        invoiceNumber: session.invoice.invoiceNumber || null,
                        invoiceSessionId: session.id,
                        riskLevelAtPreparation: session.risk?.level || null,
                        requiredOverride: false,
                        originChatId: chatId,
                        originMessageId: query.message.message_id
                    }
                });
            } catch (err: unknown) {
                logger.error(null, "[Handler] Invoice preparePayment failed", {
                    chatId: ownerChatId,
                    error: err instanceof Error ? err.message : String(err),
                });
                await bot.sendMessage(ownerChatId, "❌ Failed to prepare invoice payment. Please try again.");
            }
            return;
        }

        // Invoice: cancel
        if (data.startsWith("invcancel_") && invoiceEngine) {
            const ownerChatId = parseInt(data.replace("invcancel_", ""), 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            invoiceEngine.closeSession(ownerChatId, "cancelled");
            await bot.editMessageText("Invoice cancelled.", {
                chat_id: chatId,
                message_id: query.message.message_id
            }).catch(() => { });
            return;
        }

        // Payment request: pay
        if (data.startsWith("reqpay_") && paymentRequestEngine && paymentEngine) {
            const parts = data.split("_");
            const ownerChatId = parseInt(parts[1], 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            const requestId = parts[2];
            if (!requestId) {
                bot.answerCallbackQuery(query.id, { text: "Invalid payment request data." });
                return;
            }
            const request = paymentRequestEngine.getRequest(requestId);
            if (!request) {
                bot.answerCallbackQuery(query.id, { text: "Payment request not found." });
                return;
            }
            if (request.paid) {
                await bot.editMessageText("This payment request has already been completed.", {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }).catch(() => { });
                return;
            }
            await bot.answerCallbackQuery(query.id, { text: "Opening payment confirmation..." }).catch(() => { });
            try {
                await paymentEngine.preparePayment(
                    ownerChatId,
                    request.recipient,
                    request.amount.toString(),
                    `PayReq ${requestId}`,
                    {
                        source: {
                            type: "request",
                            requestId,
                            originChatId: chatId,
                            originMessageId: query.message.message_id
                        }
                    }
                );
            } catch (err: unknown) {
                logger.error(null, "[Handler] PayReq preparePayment failed", {
                    chatId: ownerChatId,
                    error: err instanceof Error ? err.message : String(err),
                });
                await bot.sendMessage(ownerChatId, "❌ Failed to prepare payment. Please try again.");
            }
            return;
        }

        // Payment request: cancel
        if (data.startsWith("reqcancel_") && paymentRequestEngine) {
            const parts = data.split("_");
            const ownerChatId = parseInt(parts[1], 10);
            const requestId = parts[2];
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            if (requestId) {
                paymentRequestEngine.cancelRequest(requestId);
            }
            await bot.editMessageText("Payment request cancelled.", {
                chat_id: chatId,
                message_id: query.message.message_id
            }).catch(() => { });
            return;
        }

        // Schedule: pay now
        if (data.startsWith("sched_pay_") && paymentEngine && scheduleStore) {
            const parts = data.replace("sched_pay_", "").split("_");
            const ownerChatId = parseInt(parts[0], 10);
            const scheduleId = parts.slice(1).join("_");
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            const schedule = scheduleStore.getScheduleById(ownerChatId, scheduleId);
            if (schedule) {
                await bot.answerCallbackQuery(query.id, { text: "Opening scheduled payment confirmation..." }).catch(() => { });
                try {
                    await paymentEngine.preparePayment(
                        ownerChatId,
                        schedule.vendor,
                        schedule.amount.toString(),
                        "Scheduled",
                        {
                            token: schedule.token ?? "USDC",
                            source: {
                                type: "schedule",
                                scheduleId,
                                originChatId: chatId,
                                originMessageId: query.message.message_id
                            }
                        }
                    );
                } catch (err: unknown) {
                    logger.error(null, "[Handler] Schedule preparePayment failed", {
                        chatId: ownerChatId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    await bot.sendMessage(ownerChatId, "❌ Failed to prepare scheduled payment. Please try again.");
                }
            } else {
                await bot.answerCallbackQuery(query.id, { text: "Schedule not found." }).catch(() => { });
            }
            return;
        }

        // Schedule: cancel
        if (data.startsWith("sched_cancel_") && scheduleStore) {
            const parts = data.replace("sched_cancel_", "").split("_");
            const ownerChatId = parseInt(parts[0], 10);
            const scheduleId = parts.slice(1).join("_");
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            const wasCancelled = scheduleStore.cancelSchedule(ownerChatId, scheduleId);
            const cancelMsg = wasCancelled
                ? "❌ Scheduled payment cancelled."
                : "Schedule not found or already cancelled.";
            await bot.editMessageText(cancelMsg, {
                chat_id: chatId,
                message_id: query.message.message_id
            }).catch(() => { });
            return;
        }

        // Payment confirm/cancel callbacks
        if (paymentEngine) {
            paymentEngine.processCallback(query);
        }
    });
}
