import TelegramBot from "node-telegram-bot-api";
import { WalletStore } from "../storage/walletStore";
import { VendorStore } from "../storage/vendorStore";
import { PaymentEngine } from "../engines/paymentEngine";
import { IntentParser } from "../ai/intentParser";
import { LLMKeyStore } from "../storage/llmKeyStore";
import { InvoiceEngine } from "../engines/invoiceEngine";
import { PaymentRequestEngine } from "../engines/paymentRequestEngine";
import { ToolRouter } from "../agent/toolRouter";
import { ConversationMemory } from "../agent/conversationMemory";
import { ScheduleStore } from "../storage/schedules";

export function setupHandlers(
    bot: TelegramBot,
    walletStore: WalletStore,
    vendorStore: VendorStore,
    llmKeyStore: LLMKeyStore,
    toolRouter: ToolRouter,
    intentParser: IntentParser,
    paymentEngine?: PaymentEngine,
    invoiceEngine?: InvoiceEngine,
    paymentRequestEngine?: PaymentRequestEngine,
    conversationMemory?: ConversationMemory,
    scheduleStore?: ScheduleStore
) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;

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

ArcPay Agent is your payment assistant on Arc Network testnet.

Run these to get started:
• \`create wallet\`
• \`show wallet\`
• \`send 5 usdc jack\`
• \`request 20 usdc\`
• Upload a PDF/image invoice to extract and pay it

Useful shortcuts:
• \`help\` (or \`/help\`) to see all commands
• \`report\` to check spending
• \`show recent payments\` for latest transaction activity

Security note:
• Only the wallet owner can act on payment/request/schedule buttons.

I keep it minimal and deterministic by default; ask me in plain language and I'll also understand natural requests.`;
            bot.sendMessage(chatId, startMessage, { parse_mode: "Markdown" });
            return;
        }

        // ── /help command ──
        if (text === "/help") {
            const help = `📖 *ArcPay Agent — Command Reference*

*⚡ Quick Start*
• \`create wallet\` — Create your Circle wallet
• \`show wallet\` — Show wallet address
• \`my vendors\` / \`save vendor jack 0x...\` — Manage vendor list
• \`send 5 usdc jack\` — Send USDC
• \`request 20 usdc\` — Generate a shareable payment link

*💳 Payments*
• \`send 3 usdc 0x...\` / \`pay 3 usdc to alice\` — Send to address or vendor
• \`schedule payment 10 usdc aws tomorrow\` — Create scheduled payment
• \`list schedules\` / \`cancel schedule <id>\` — Manage future payments

*🧾 Invoice Workflow*
• Send a PDF or photo invoice
• \`analyze invoice\` — Request extraction explicitly
• \`pay the invoice\` / \`pay that invoice\` after extraction

• Payment control callbacks:
  - \`confirm\` → continue payment
  - \`cancel\` → cancel payment
  - \`approve\` → approve USDC spend when required

*📚 History & Intelligence*
• \`payment history\` or \`report\` — Recent local payment history
• \`show recent payments\` — On-chain router activity (chunked scan)
• \`show pending payments\` — Router pending status/info

*📈 Reports*
• \`report\` — Spending summary (last 30 days)
• \`spending by vendor\` — Vendor breakdown
• \`payment history\` — Last transaction list
• \`monthly spending\` — Monthly totals

*🤖 AI / LLM*
• \`/llmkey set openai sk-...\` — Save your LLM key
• \`/llmkey model gpt-4o\` — Change model
• \`/llmkey status\` — Check status
• \`/llmkey remove\` — Remove key

*🔧 Wallet/Account*
• \`status\` — Account status
• \`wallet_intelligence\` — Wallet balance + explorer activity
• \`export wallet\` — Export wallet details

_Tip: You can use natural language too; examples: “send 10 usdc to jack”, “pay the invoice”, “show recent payments”._`;
            bot.sendMessage(chatId, help, { parse_mode: "Markdown" });
            return;
        }

        // ── /llmkey commands (must bypass intent parser) ──
        const llmSetMatch = originalText.match(/^\/llmkey\s+set\s+([a-zA-Z0-9_-]+)\s+(.+)/i);
        if (llmSetMatch) {
            const provider = llmSetMatch[1];
            const key = llmSetMatch[2];
            llmKeyStore.setKey(chatId, provider, key);
            bot.sendMessage(chatId, `✅ LLM Key successfully saved for provider: ${provider}`);
            return;
        }

        const llmModelMatch = originalText.match(/^\/llmkey\s+model\s+(.+)/i);
        if (llmModelMatch) {
            // Support both `/llmkey model gpt-4o` and `/llmkey model openai gpt-4o`
            const parts = llmModelMatch[1].trim().split(/\s+/);
            const model = parts[parts.length - 1];
            const updated = llmKeyStore.setModel(chatId, model);
            if (updated) {
                bot.sendMessage(chatId, `✅ LLM Model updated to: ${model}`);
            } else {
                bot.sendMessage(chatId, "❌ Please set an LLM Key first using `/llmkey set`.");
            }
            return;
        }

        if (text === "/llmkey remove") {
            const removed = llmKeyStore.removeKey(chatId);
            bot.sendMessage(chatId, removed ? "✅ LLM Key removed." : "No LLM Key found to remove.");
            return;
        }

        if (text === "/llmkey status") {
            bot.sendMessage(chatId, llmKeyStore.getStatus(chatId));
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
                    const actionSummaries: Record<string, string> = {
                        show_wallet: "I showed the user their wallet address.",
                        create_wallet: "I created a new wallet for the user.",
                        status: "I showed the user their account status.",
                        list_vendors: "I listed the user's saved vendors.",
                        vendor_detail: "I showed detailed stats for a vendor.",
                        top_vendors: "I showed the user's top vendors by spending.",
                        export_wallet: "I showed wallet export information.",
                        report: "I showed the spending report.",
                        spending_by_vendor: "I showed spending breakdown by vendor.",
                        payment_history: "I showed recent payment history.",
                        monthly_spending: "I showed monthly spending breakdown.",
                        analyze_invoice: "I asked the user to send an invoice file.",
                        create_payment: "I prepared a payment for the user.",
                        save_vendor: "I saved a vendor for the user.",
                        remove_vendor: "I removed a vendor for the user.",
                        remove_all_vendors: "I removed all vendors for the user.",
                        create_payment_request: "I created a payment request link.",
                        schedule_payment: "I scheduled a future payment for the user.",
                        list_schedules: "I listed the user's scheduled payments.",
                        cancel_schedule: "I cancelled a scheduled payment.",
                        show_pending_payments: "I showed the user their pending router payments.",
                        show_recent_payments: "I showed the user their recent router payments.",
                        wallet_intelligence: "I showed the user their Circle wallet intelligence and balance.",
                    };
                    const summary = actionSummaries[intent.action] || `I executed the ${intent.action} action.`;
                    conversationMemory.addBotMessage(chatId, summary);
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

        if (data.startsWith("sched_skip_") && scheduleStore) {
            const parts = data.replace("sched_skip_", "").split("_");
            const ownerChatId = parseInt(parts[0], 10);
            const scheduleId = parts.slice(1).join("_");
            if (!Number.isInteger(ownerChatId) || ownerChatId !== senderId) {
                await rejectUnauthorized();
                return;
            }
            scheduleStore.markExecuted(ownerChatId, scheduleId);
            bot.editMessageText("⏭️ Scheduled payment skipped.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
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
