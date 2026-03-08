import TelegramBot from "node-telegram-bot-api";
import { WalletStore } from "../storage/walletStore";
import { VendorStore } from "../storage/vendorStore";
import { PaymentEngine } from "../engines/paymentEngine";
import { IntentParser } from "../ai/intentParser";
import { InvoiceEngine } from "../engines/invoiceEngine";
import { PaymentRequestEngine } from "../engines/paymentRequestEngine";
import { ToolRouter } from "../agent/toolRouter";
import { ConversationMemory } from "../agent/conversationMemory";
import { ScheduleStore } from "../storage/schedules";
import { UserPreferencesStore } from "../storage/userPreferences";

export function setupHandlers(
    bot: TelegramBot,
    walletStore: WalletStore,
    vendorStore: VendorStore,
    llmKeyStore: any,
    toolRouter: ToolRouter,
    intentParser: IntentParser,
    paymentEngine?: PaymentEngine,
    invoiceEngine?: InvoiceEngine,
    paymentRequestEngine?: PaymentRequestEngine,
    conversationMemory?: ConversationMemory,
    scheduleStore?: ScheduleStore,
    userPreferencesStore?: UserPreferencesStore
) {
    const helpMessage = `📖 *ArcPay Agent — Command Guide*

*Wallet*
• \`create wallet\` — Create your wallet
• \`show wallet\` — Show your wallet address
• \`wallet balance\` — Show live balance and recent chain activity
• \`account summary\` — Show your account overview
• \`status\` — Show account status
• \`export wallet\` — Show wallet export details

*Payments*
• \`send 5 usdc to jack\` — Send to a saved vendor
• \`send 5 usdc to "Anthropic, PBC"\` — Send to a multi-word vendor
• \`send 5 usdc to 0x...\` — Send to a wallet address
• \`request 20 usdc\` — Create a payment link
• \`payment history\` — Show recent payments

*Address Book*
• \`save vendor jack 0x...\` — Save a vendor
• \`save vendor "Anthropic, PBC" 0x...\` — Save a multi-word vendor
• \`my vendors\` — List saved vendors
• \`vendor "Anthropic, PBC"\` — Show vendor details
• \`top vendors\` — Show top vendors
• \`remove vendor "Anthropic, PBC"\` — Remove one vendor

*Invoices*
• Send a PDF or photo invoice
• \`analyze invoice\` — Ask for invoice extraction
• \`pay that invoice\` — Use the last analyzed invoice

*LLM*
• \`/llmkey status\` — Show your saved LLM provider
• \`/llmkey set openai sk-...\` — Save your own API key
• \`/llmkey model gpt-4.1-mini\` — Set your preferred model
• \`/llmkey remove\` — Remove your saved API key

*Schedules*
• \`schedule payment 10 usdc to aws tomorrow\` — Create a schedule
• \`list schedules\` — List active schedules
• \`cancel schedule <id>\` — Cancel a schedule

*Reports*
• \`show recent payments\` — Show router activity
• \`show pending payments\` — Show pending router status
• \`report\` — Show spending summary
• \`spending by vendor\` — Show vendor breakdown
• \`monthly spending\` — Show monthly totals

_Tip: Natural language works too. Example: “send 10 usdc to jack”, “show recent payments”, “pay the invoice”._`;

    bot.setMyCommands([
        { command: "start", description: "Open the ArcPay quick start guide" },
        { command: "help", description: "Show the full command guide" },
    ]).catch((error) => {
        console.warn("[Telegram] Failed to register bot commands:", error);
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (msg.from?.language_code && userPreferencesStore) {
            userPreferencesStore.setLocaleIfMissing(chatId, msg.from.language_code);
        }

        // ── Handle document uploads (PDF invoices) ──
        if (msg.document && invoiceEngine) {
            const doc = msg.document;
            const mime = doc.mime_type || "";

            if (mime === "application/pdf") {
                try {
                    bot.sendMessage(chatId, "📄 Analyzing invoice PDF...");
                    const fileLink = await bot.getFileLink(doc.file_id);
                    const response = await fetch(fileLink);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const extracted = await invoiceEngine.analyzeInvoice(buffer, "application/pdf");

                    // Store invoice context for follow-up references
                    if (conversationMemory && (extracted.amount || extracted.vendor)) {
                        conversationMemory.setLastInvoice(chatId, {
                            vendor: extracted.vendor,
                            amount: extracted.amount,
                            currency: extracted.currency,
                            detectedAmount: extracted.detectedAmount,
                            detectedCurrency: extracted.detectedCurrency,
                            settlementAmount: extracted.settlementAmount,
                            settlementCurrency: extracted.settlementCurrency,
                            invoiceNumber: extracted.invoiceNumber
                        });
                    }

                    await invoiceEngine.processInvoice(chatId, extracted);
                } catch (err: any) {
                    bot.sendMessage(chatId, `❌ Failed to process PDF: ${err.message}`);
                }
                return;
            }
        }

        // ── Handle photo uploads (image invoices via OCR) ──
        if (msg.photo && msg.photo.length > 0 && invoiceEngine) {
            try {
                bot.sendMessage(chatId, "🖼️ Analyzing invoice image...");
                const photo = msg.photo[msg.photo.length - 1];
                const fileLink = await bot.getFileLink(photo.file_id);
                const response = await fetch(fileLink);
                const buffer = Buffer.from(await response.arrayBuffer());
                const extracted = await invoiceEngine.analyzeInvoice(buffer, "image/png");

                // Store invoice context for follow-up references
                if (conversationMemory && (extracted.amount || extracted.vendor)) {
                    conversationMemory.setLastInvoice(chatId, {
                        vendor: extracted.vendor,
                        amount: extracted.amount,
                        currency: extracted.currency,
                        detectedAmount: extracted.detectedAmount,
                        detectedCurrency: extracted.detectedCurrency,
                        settlementAmount: extracted.settlementAmount,
                        settlementCurrency: extracted.settlementCurrency,
                        invoiceNumber: extracted.invoiceNumber
                    });
                }

                await invoiceEngine.processInvoice(chatId, extracted);
            } catch (err: any) {
                bot.sendMessage(chatId, `❌ Failed to process image: ${err.message}`);
            }
            return;
        }

        // ── Text message handling ──
        const originalText = msg.text?.trim() || "";
        const text = originalText.toLowerCase();

        if (!text) return;

        // ── /start deep link handling (must bypass intent parser) ──
        // Use originalText to preserve case-sensitive request IDs
        const startMatch = originalText.match(/^\/start\s+req_(.+)/i);
        if (startMatch && paymentRequestEngine) {
            const requestId = startMatch[1];
            paymentRequestEngine.handleDeepLink(chatId, requestId);
            return;
        }

        // ── /start welcome message ──
        if (text === "/start") {
            const startMessage = `🚀 *Welcome to ArcPay Agent*

ArcPay helps you manage wallets, vendors, payments, invoices, and schedules on Arc testnet.

*Start here*
• \`create wallet\`
• \`show wallet\`
• \`account summary\`
• \`save vendor jack 0x...\`
• \`send 5 usdc to jack\`

*Also supported*
• Send a PDF or photo invoice
• \`request 20 usdc\`
• \`schedule payment 10 usdc to aws tomorrow\`
• \`/llmkey set openai sk-...\`

Type \`help\` or \`/help\` to see the full command list.

Only the wallet owner can use payment, request, and schedule action buttons.`;
            bot.sendMessage(chatId, startMessage, { parse_mode: "Markdown" });
            return;
        }

        // ── /help command ──
        if (text === "/help") {
            bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
            return;
        }

        if (text === "/health" || text === "/ready") {
            const endpoint = text === "/health" ? "/health" : "/ready";
            bot.sendMessage(
                chatId,
                `\`${endpoint}\` is an HTTP endpoint, not a Telegram command.\n\nUse it in your browser or with curl against your deployed service URL.\n\nExample:\n\`https://your-service.onrender.com${endpoint}\``,
                { parse_mode: "Markdown" }
            );
            return;
        }

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

        // ── AI Intent Pipeline: Parse → Route ──
        try {
            // Track user message in conversation memory
            if (conversationMemory) {
                conversationMemory.addUserMessage(chatId, originalText);
            }

            const intent = await intentParser.parse(chatId, text);
            await toolRouter.routeIntent(chatId, intent);

            // Track bot response in conversation memory
            if (conversationMemory) {
                conversationMemory.setLastAction(chatId, intent.action);

                if (intent.message) {
                    // LLM provided a message (chat, greeting, etc.)
                    conversationMemory.addBotMessage(chatId, intent.message);
                } else {
                    // Action intent — add a description so LLM knows what happened
                    let summary = `I executed the ${intent.action} action.`;
                    switch (intent.action) {
                        case "show_wallet":
                            summary = "I showed the wallet address.";
                            break;
                        case "create_wallet":
                            summary = "I created a new wallet.";
                            break;
                        case "status":
                            summary = "I showed the account status.";
                            break;
                        case "list_vendors":
                            summary = "I listed the saved vendors.";
                            break;
                        case "vendor_detail":
                            summary = intent.name ? `I showed details for vendor ${intent.name}.` : "I showed vendor details.";
                            break;
                        case "top_vendors":
                            summary = "I showed the top vendors by spending.";
                            break;
                        case "export_wallet":
                            summary = "I showed the wallet export details.";
                            break;
                        case "report":
                            summary = "I showed the spending report.";
                            break;
                        case "spending_by_vendor":
                            summary = "I showed spending broken down by vendor.";
                            break;
                        case "payment_history":
                            summary = "I showed recent payment history.";
                            break;
                        case "monthly_spending":
                            summary = "I showed the monthly spending breakdown.";
                            break;
                        case "analyze_invoice":
                            summary = "I asked for an invoice file to analyze.";
                            break;
                        case "create_payment":
                            summary = intent.amount && intent.beneficiary
                                ? `I prepared a payment of ${intent.amount} USDC to ${intent.beneficiary}.`
                                : "I prepared a payment.";
                            if (intent.amount && intent.beneficiary) {
                                conversationMemory.setLastPayment(chatId, intent.beneficiary, intent.amount.toString());
                            }
                            break;
                        case "save_vendor":
                            summary = intent.name ? `I saved vendor ${intent.name}.` : "I saved a vendor.";
                            break;
                        case "remove_vendor":
                            summary = intent.name ? `I removed vendor ${intent.name}.` : "I removed a vendor.";
                            break;
                        case "remove_all_vendors":
                            summary = "I removed all saved vendors.";
                            break;
                        case "create_payment_request":
                            summary = intent.amount ? `I created a payment request for ${intent.amount} USDC.` : "I created a payment request.";
                            break;
                        case "schedule_payment":
                            summary = intent.amount && intent.beneficiary
                                ? `I scheduled ${intent.amount} USDC to ${intent.beneficiary}.`
                                : "I scheduled a payment.";
                            break;
                        case "list_schedules":
                            summary = "I listed the scheduled payments.";
                            break;
                        case "cancel_schedule":
                            summary = intent.name ? `I cancelled schedule ${intent.name}.` : "I cancelled a schedule.";
                            break;
                        case "show_pending_payments":
                            summary = "I showed pending router payment status.";
                            break;
                        case "show_recent_payments":
                            summary = "I showed recent router payment activity.";
                            break;
                        case "wallet_intelligence":
                            summary = "I showed the live wallet balance and recent activity.";
                            break;
                    }
                    conversationMemory.addBotMessage(chatId, summary);
                    conversationMemory.recordAction(chatId, intent.action, summary);
                }
            }
        } catch (error) {
            console.error("Intent pipeline error:", error);
            bot.sendMessage(chatId, "Something went wrong processing your request.");
        }
    });

    bot.on('callback_query', async (query) => {
        const data = query.data;
        if (!data || !query.message) return;
        const chatId = query.message.chat.id;
        const senderId = query.from?.id;

        if (!senderId) {
            await bot.answerCallbackQuery(query.id, { text: "Unable to verify user." });
            return;
        }

        const rejectUnauthorized = () => bot.answerCallbackQuery(query.id, {
            text: "This action is not available for your account."
        });

        // ── Invoice callbacks ──
        if (data.startsWith("invpay_") && invoiceEngine && paymentEngine) {
            const ownerChatId = parseInt(data.replace("invpay_", ""), 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }

            let pending = invoiceEngine.getPendingInvoice(ownerChatId);

            // Fall back to conversation memory if pending invoice was lost (e.g. bot restart)
            if ((!pending || !pending.amount) && conversationMemory) {
                const lastInv = conversationMemory.getContext(ownerChatId).lastInvoice;
                if (lastInv && lastInv.amount) {
                    pending = {
                        vendor: lastInv.vendor,
                        amount: lastInv.amount,
                        currency: lastInv.currency,
                        detectedAmount: lastInv.detectedAmount,
                        detectedCurrency: lastInv.detectedCurrency,
                        settlementAmount: lastInv.settlementAmount,
                        settlementCurrency: lastInv.settlementCurrency,
                        invoiceNumber: lastInv.invoiceNumber || null,
                        date: null
                    };
                }
            }

            if (!pending || !pending.amount || !pending.vendor) {
                bot.answerCallbackQuery(query.id, { text: "Invoice session expired. Please resend the invoice." });
                return;
            }

            invoiceEngine.storeInvoice(ownerChatId, pending);

            const vendorAddress = vendorStore.getVendor(ownerChatId, pending.vendor);
            const beneficiary = vendorAddress || pending.vendor;

            bot.editMessageText("Preparing payment from invoice...", {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            invoiceEngine.clearPendingInvoice(ownerChatId);
            paymentEngine.preparePayment(ownerChatId, beneficiary, pending.amount, `Invoice ${pending.invoiceNumber || "N/A"}`);
            return;
        }

        if (data.startsWith("invcancel_") && invoiceEngine) {
            const ownerChatId = parseInt(data.replace("invcancel_", ""), 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }

            invoiceEngine.clearPendingInvoice(ownerChatId);
            bot.editMessageText("Invoice cancelled.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            return;
        }

        // ── Payment request callbacks ──
        if (data.startsWith("reqpay_") && paymentRequestEngine && paymentEngine) {
            const parts = data.split("_");
            const ownerChatId = parseInt(parts[1], 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            if (!parts[2]) {
                bot.answerCallbackQuery(query.id, { text: "Invalid payment request data." });
                return;
            }
            const requestId = parts[2];
            const request = paymentRequestEngine.getRequest(requestId);

            if (!request) {
                bot.answerCallbackQuery(query.id, { text: "Payment request not found." });
                return;
            }

            if (request.paid) {
                bot.editMessageText("This payment request has already been completed.", {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
                return;
            }

            bot.editMessageText("Preparing payment from request...", {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            paymentRequestEngine.markPaid(requestId);
            paymentEngine.preparePayment(ownerChatId, request.recipient, request.amount.toString(), `PayReq ${requestId}`);
            return;
        }

        if (data.startsWith("reqcancel_")) {
            const parts = data.split("_");
            const ownerChatId = parseInt(parts[1], 10);
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            bot.editMessageText("Payment request cancelled.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            return;
        }

        // ── Schedule callbacks (format: sched_pay_<ownerChatId>_<scheduleId>) ──
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
                bot.editMessageText(`Preparing scheduled payment: ${schedule.amount} USDC → ${schedule.vendor}...`, {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
                scheduleStore.markExecuted(ownerChatId, scheduleId);
            paymentEngine.preparePayment(ownerChatId, schedule.vendor, schedule.amount.toString(), "Scheduled");
            } else {
                bot.answerCallbackQuery(query.id, { text: "Schedule not found." });
            }
            return;
        }

        if (data.startsWith("sched_cancel_") && scheduleStore) {
            const parts = data.replace("sched_cancel_", "").split("_");
            const ownerChatId = parseInt(parts[0], 10);
            const scheduleId = parts.slice(1).join("_");
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            scheduleStore.cancelSchedule(ownerChatId, scheduleId);
            bot.editMessageText("❌ Scheduled payment cancelled.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            return;
        }

        // ── Payment callbacks (confirm, approve, cancel) ──
        if (paymentEngine) {
            paymentEngine.processCallback(query);
        }
    });
}
