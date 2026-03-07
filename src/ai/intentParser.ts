import { LLMKeyStore } from "../storage/llmKeyStore";
import { ConversationMemory } from "../agent/conversationMemory";
import { SessionStore } from "../agent/sessionStore";
import { MemoryStore } from "./memoryStore";
import { buildDecision } from "./decisionEngine";
import { resolveSlots } from "./resolveSlots";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { validateIntent } from "./validateIntent";
import { parseScheduleDate } from "../utils/dateParser";

export interface ParsedIntent {
    action: string;
    amount?: number;
    beneficiary?: string;
    name?: string;
    address?: string;
    schedule_time?: string;
    frequency?: string;
    message?: string;
    input?: string;
    confidence?: number;
    plan?: string[];
    rationale?: string;
    safeToExecute?: boolean;
    needsClarification?: boolean;
}

export class IntentParser {
    constructor(
        private llmKeyStore?: LLMKeyStore,
        private memory?: ConversationMemory,
        private sessionStore?: SessionStore,
        private memoryStore?: MemoryStore
    ) { }

    async parse(chatId: number, input: string): Promise<ParsedIntent> {
        const rawText = input.trim();
        const decision = buildDecision(rawText);
        const text = decision.normalizedText;
        const logIntent = (intent: ParsedIntent) => {
            if (process.env.LOG_INTENT) {
                const conf = intent.confidence !== undefined ? intent.confidence : "n/a";
                console.log(`[intent] chatId=${chatId} action=${intent.action} confidence=${conf} text="${rawText}"`);
            }
        };
        const finalizeIntent = (baseIntent: ParsedIntent, confidence: number): ParsedIntent => {
            const resolvedIntent = resolveSlots({
                chatId,
                intent: baseIntent,
                conversationMemory: this.memory,
                sessionStore: this.sessionStore,
                memoryStore: this.memoryStore
            }) as ParsedIntent;
            const validation = validateIntent(resolvedIntent);

            return {
                ...resolvedIntent,
                confidence,
                plan: this.buildPlan(resolvedIntent),
                safeToExecute: validation.safeToExecute,
                needsClarification: validation.needsClarification,
                message: validation.message || resolvedIntent.message
            };
        };

        // ── Layer 1: Deterministic decision engine ──
        if (decision.detectedIntent) {
            const intent = finalizeIntent(decision.detectedIntent as ParsedIntent, 0.92);
            logIntent(intent);
            return intent;
        }

        // ── Layer 2: Regex parser fallback ──
        const regexResult = this.regexParse(text);
        if (regexResult) {
            const intent = finalizeIntent(regexResult, 0.9);
            logIntent(intent);
            return intent;
        }

        // ── Layer 3: Context-aware follow-ups ──
        if (this.sessionStore) {
            const sessionFollowUp = this.resolveSessionFollowUp(chatId, text);
            if (sessionFollowUp) {
                const intent = finalizeIntent(sessionFollowUp, 0.75);
                logIntent(intent);
                return intent;
            }
        }

        if (this.memory) {
            const followUp = this.resolveFollowUp(chatId, text);
            if (followUp) {
                const intent = finalizeIntent(followUp, 0.7);
                logIntent(intent);
                return intent;
            }
        }

        // ── Layer 4: Heuristics ──
        const heuristicResult = this.heuristicParse(chatId, text);
        if (heuristicResult) {
            const intent = finalizeIntent(heuristicResult, 0.6);
            logIntent(intent);
            return intent;
        }

        // ── Layer 5: LLM fallback (only if key exists) ──
        const hasLLM = this.llmKeyStore && this.llmKeyStore.hasKey(chatId);
        if (hasLLM) {
            const llmIntent = await this.llmFallback(chatId, text);
            const intent = finalizeIntent(llmIntent, llmIntent.confidence ?? 0.5);
            logIntent(intent);
            return intent;
        }

        // ── Final smart fallback ──
        const fallback = this.buildSmartFallback(chatId, text);
        const intent = finalizeIntent(fallback, 0.4);
        logIntent(intent);
        return intent;
    }

    /**
     * Layer 1 — Regex-based intent detection
     */
    private regexParse(text: string): ParsedIntent | null {
        const timeExpression = '((?:(?:after|in)\\s+)?\\d+\\s*(?:second|seconds|minute|minutes|hour|hours|day|days|week|weeks)|tomorrow|today|next\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))';

        const arcScanLinkPattern = /^(?=.*(?:arc\s*scan|arcscan|block\s+explorer|explorer))(?=.*(?:link|url|site|website|open|send|give)).*$/i;
        if (arcScanLinkPattern.test(text)) {
            return {
                action: "chat",
                message: "ArcScan testnet explorer: https://testnet.arcscan.app/"
            };
        }

        // wallet balance (short form) — prioritize before generic wallet/status
        const walletBalancePattern = /^wallet\s+balance$/i;
        if (walletBalancePattern.test(text)) return { action: "wallet_intelligence" };

        // schedule payment 1 usdc to jack 10 seconds
        const explicitSchedulePattern = new RegExp(
            `^schedule\\s+payment\\s+(\\d+(?:\\.\\d+)?)\\s+usdc\\s+(?:to\\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)\\s+${timeExpression}$`,
            "i"
        );
        const explicitScheduleMatch = text.match(explicitSchedulePattern);
        if (explicitScheduleMatch) {
            return {
                action: "schedule_payment",
                amount: parseFloat(explicitScheduleMatch[1]),
                beneficiary: explicitScheduleMatch[2],
                schedule_time: explicitScheduleMatch[3]
            };
        }

        // schedule payment: send/pay/transfer 1 usdc to jack after 10 seconds
        const scheduledPaymentPattern = new RegExp(
            `^(?:send|pay|transfer)\\s+(\\d+(?:\\.\\d+)?)\\s+usdc\\s+(?:to\\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)\\s+${timeExpression}$`,
            "i"
        );
        const scheduledMatch = text.match(scheduledPaymentPattern);
        if (scheduledMatch) {
            return {
                action: "schedule_payment",
                amount: parseFloat(scheduledMatch[1]),
                beneficiary: scheduledMatch[2],
                schedule_time: scheduledMatch[3]
            };
        }

        // send 1 usdc jack | send 5 usdc to 0xabc
        const sendPattern1 = /^send\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?([a-zA-Z0-9_x]+)/i;
        const m1 = text.match(sendPattern1);
        if (m1) return { action: "create_payment", amount: parseFloat(m1[1]), beneficiary: m1[2] };

        // 0xabc... send 1 usdc
        const sendPattern2 = /^(0[xX][a-fA-F0-9]{40})\s+send\s+(\d+(?:\.\d+)?)\s+usdc$/i;
        const m2 = text.match(sendPattern2);
        if (m2) return { action: "create_payment", amount: parseFloat(m2[2]), beneficiary: m2[1] };

        // pay 10 usdc to jack
        const payPattern = /^pay\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?([a-zA-Z0-9_x]+)/i;
        const mp = text.match(payPattern);
        if (mp) return { action: "create_payment", amount: parseFloat(mp[1]), beneficiary: mp[2] };

        // transfer 5 usdc to jack
        const transferPattern = /^transfer\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?([a-zA-Z0-9_x]+)/i;
        const mt = text.match(transferPattern);
        if (mt) return { action: "create_payment", amount: parseFloat(mt[1]), beneficiary: mt[2] };

        // send jack / pay jack (no amount) -> ask for amount, keep beneficiary
        const sendNoAmount1 = /^(?:send|pay)\s+([a-zA-Z0-9_x]+)$/i;
        const mNoAmt1 = text.match(sendNoAmount1);
        if (mNoAmt1) return { action: "create_payment", beneficiary: mNoAmt1[1] };

        // save vendor jack 0xabc...
        const vendorPattern = /^(?:save|add)\s+vendor\s+([a-zA-Z0-9_]+)\s+(0[xX][a-fA-F0-9]{40})/i;
        const mv = text.match(vendorPattern);
        if (mv) return { action: "save_vendor", name: mv[1], address: mv[2] };

        // create payment request 20 usdc | request 5 usdc
        const reqPattern = /^(?:create\s+)?(?:payment\s+)?request\s+(\d+(?:\.\d+)?)\s+usdc/i;
        const mr = text.match(reqPattern);
        if (mr) return { action: "create_payment_request", amount: parseFloat(mr[1]) };

        // remove vendor jack | delete vendor jack
        const removeVendorPattern = /^(?:remove|delete)\s+vendor\s+([a-zA-Z0-9_]+)/i;
        const mrv = text.match(removeVendorPattern);
        if (mrv) return { action: "remove_vendor", name: mrv[1] };

        // remove all vendors | delete all vendors | clear vendors
        const removeAllPattern = /^(?:remove|delete|clear)\s+all\s+vendors?/i;
        if (removeAllPattern.test(text)) return { action: "remove_all_vendors" };

        // vendor aws | vendor detail jack
        const vendorDetailPattern = /^vendor\s+(?:detail\s+)?([a-zA-Z0-9_]+)/i;
        const mvd = text.match(vendorDetailPattern);
        if (mvd) return { action: "vendor_detail", name: mvd[1] };

        // top vendors
        const topVendorsPattern = /^top\s+vendors?/i;
        if (topVendorsPattern.test(text)) return { action: "top_vendors" };

        // router pending payments
        const pendingPattern = /^(?:show|list|get)\s+(?:my\s+)?pending\s+payments?/i;
        if (pendingPattern.test(text)) return { action: "show_pending_payments" };

        // router recent payments
        const recentPattern = /^(?:show|list|get)\s+(?:my\s+)?(?:recent|router)\s+(?:payments?|activity|events?)/i;
        if (recentPattern.test(text)) return { action: "show_recent_payments" };

        // circle wallet status / balance
        const walletIntelligencePattern = /^(?:show|get|check)\s+(?:my\s+)?(?:circle\s+)?(?:wallet\s+)?(?:status|balance|data)/i;
        if (walletIntelligencePattern.test(text)) return { action: "wallet_intelligence" };

        // monthly spending natural
        const monthlySpendingPattern = /monthly\s+spending/i;
        if (monthlySpendingPattern.test(text)) return { action: "monthly_spending" };

        const paymentHistoryPattern = /payment\s+history/i;
        if (paymentHistoryPattern.test(text)) return { action: "payment_history" };

        return null;
    }

    /**
     * Layer 2 — Context-aware follow-up resolution
     * Handles "pay that invoice", "do it", "yes", etc.
     */
    private resolveFollowUp(chatId: number, text: string): ParsedIntent | null {
        if (!this.memory) return null;

        const lower = text.toLowerCase().trim();
        const ctx = this.memory.getContext(chatId);

        // ── "pay that / pay it / pay the invoice / do it / yes do it" ──
        const payFollowUp = /^(pay\s+(that|it|this|the\s+invoice)|do\s+it|go\s+ahead|proceed|execute|yes\s*,?\s*(do\s+it|pay|proceed|go)?|confirm|let'?s\s+do\s+it|make\s+(that|the)\s+payment)$/i;
        if (payFollowUp.test(lower) && ctx.lastInvoice?.amount && ctx.lastInvoice?.vendor) {
            return {
                action: "create_payment",
                amount: parseFloat(ctx.lastInvoice.amount),
                beneficiary: ctx.lastInvoice.vendor,
                message: `Got it! Preparing payment of ${ctx.lastInvoice.amount} ${ctx.lastInvoice.currency || "USDC"} to ${ctx.lastInvoice.vendor}.`
            };
        }

        // ── Asking about the last invoice ──
        const invoiceQuery = /^(how\s+much|what\s+was|details?\s+(of|about)|show\s+(me\s+)?(the|that)|tell\s+me\s+about)\s*(the\s+)?(invoice|bill|pdf|document)?$/i;
        if (invoiceQuery.test(lower) && ctx.lastInvoice) {
            const inv = ctx.lastInvoice;
            let msg = `📄 Here's the last invoice I analyzed:\n\n`;
            if (inv.vendor) msg += `• Vendor: *${inv.vendor}*\n`;
            if (inv.amount) msg += `• Amount: *${inv.amount} ${inv.currency || "USD"}*\n`;
            if (inv.invoiceNumber) msg += `• Invoice #: ${inv.invoiceNumber}\n`;
            msg += `\nWould you like me to prepare this payment?`;
            return { action: "chat", message: msg };
        }

        // ── "send again" / "repeat" referencing last payment ──
        const repeatPayment = /^(send\s+again|repeat|same\s+payment|do\s+(it|that)\s+again|resend)$/i;
        if (repeatPayment.test(lower) && ctx.lastPayment) {
            return {
                action: "create_payment",
                amount: parseFloat(ctx.lastPayment.amount),
                beneficiary: ctx.lastPayment.beneficiary,
                message: `Repeating: ${ctx.lastPayment.amount} USDC to ${ctx.lastPayment.beneficiary}.`
            };
        }

        return null;
    }

    private resolveSessionFollowUp(chatId: number, text: string): ParsedIntent | null {
        if (!this.sessionStore) return null;

        const session = this.sessionStore.getSession(chatId);
        const lower = text.toLowerCase().trim();

        // If there's a pending payment
        if (session.pendingAction === 'confirm_payment' && session.pendingPayment) {
            // Handle simple confirmations: yes, confirm, go ahead
            const confirmMatches = /^(yes|confirm|go\s+ahead|do\s+it|proceed|sure|ok|okay)$/i;
            if (confirmMatches.test(lower)) {
                return {
                    action: "create_payment",
                    amount: session.pendingPayment.amount,
                    beneficiary: session.pendingPayment.vendor || session.lastVendor || "Unknown"
                };
            }

            // Handle amount modifications: "actually make it 3", "change to 5 usdc", "make it 10"
            const changeAmountMatch = /(?:actually\s+)?(?:make\s+it|change\s+to|update\s+to)\s+(\d+(?:\.\d+)?)/i;
            const amountMatch = lower.match(changeAmountMatch);
            if (amountMatch) {
                const newAmount = parseFloat(amountMatch[1]);
                this.sessionStore.updatePendingPayment(chatId, { amount: newAmount });
                return {
                    action: "update_payment_amount",
                    amount: newAmount,
                    beneficiary: session.pendingPayment.vendor || session.lastVendor || "Unknown"
                };
            }

            // Handle vendor modifications: "use the same vendor", "change to jack"
            // Though changing vendor is slightly more complex, we can handle basic updates
            const changeVendorMatch = /(?:change\s+to|use)\s+([a-zA-Z0-9_x]+)/i;
            const vendorMatch = lower.match(changeVendorMatch);
            // Ignore if it matches numbers (meaning it was an amount change, handled above)
            if (vendorMatch && !/^\d+(?:\.\d+)?$/.test(vendorMatch[1])) {
                let newVendor = vendorMatch[1];
                if (newVendor === "same" && session.lastVendor) {
                    newVendor = session.lastVendor;
                }
                if (newVendor !== "same" && newVendor !== "it") {
                    this.sessionStore.updatePendingPayment(chatId, { vendor: newVendor });
                    return {
                        action: "update_payment_vendor",
                        amount: session.pendingPayment.amount,
                        beneficiary: newVendor
                    };
                }
            }

            // Handle memo modifications: "add memo coffee", "set memo dinner", "clear memo"
            const memoMatch = /^(?:add|set|update)\s+memo\s+(.+)$/i;
            const mMemo = lower.match(memoMatch);
            if (mMemo) {
                return { action: "update_payment_memo", message: mMemo[1] };
            }
            if (/(?:clear|remove|delete)\s+memo/i.test(lower)) {
                return { action: "update_payment_memo", message: "clear" };
            }

            // Handle cancel flow via NLP
            const cancelMatch = /^(?:cancel|abort|stop|nevermind)(?:\s+(?:that|it|the\s+payment|that\s+payment))?$/i;
            if (cancelMatch.test(lower)) {
                return { action: "cancel_payment" };
            }
        }

        if (session.pendingAction === "collect_intent_details" && session.pendingIntent) {
            const pendingIntent = session.pendingIntent;
            const amountOnlyMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:usdc)?$/i);

            if (pendingIntent.action === "create_payment") {
                if (amountOnlyMatch && pendingIntent.beneficiary) {
                    const newAmount = parseFloat(amountOnlyMatch[1]);
                    return {
                        action: "create_payment",
                        amount: newAmount,
                        beneficiary: pendingIntent.beneficiary
                    };
                }

                if ((ethersLikeAddress(lower) || /^[a-zA-Z0-9_]+$/i.test(lower)) && pendingIntent.amount !== undefined) {
                    return {
                        action: "create_payment",
                        amount: pendingIntent.amount,
                        beneficiary: lower
                    };
                }
            }

            if (pendingIntent.action === "schedule_payment") {
                if (parseScheduleDate(lower) && pendingIntent.amount !== undefined && pendingIntent.beneficiary) {
                    return {
                        action: "schedule_payment",
                        amount: pendingIntent.amount,
                        beneficiary: pendingIntent.beneficiary,
                        schedule_time: lower
                    };
                }

                if (amountOnlyMatch && pendingIntent.beneficiary && pendingIntent.schedule_time) {
                    return {
                        action: "schedule_payment",
                        amount: parseFloat(amountOnlyMatch[1]),
                        beneficiary: pendingIntent.beneficiary,
                        schedule_time: pendingIntent.schedule_time
                    };
                }

                if ((ethersLikeAddress(lower) || /^[a-zA-Z0-9_]+$/i.test(lower)) && pendingIntent.amount !== undefined && pendingIntent.schedule_time) {
                    return {
                        action: "schedule_payment",
                        amount: pendingIntent.amount,
                        beneficiary: lower,
                        schedule_time: pendingIntent.schedule_time
                    };
                }
            }
        }

        return null;
    }

    /**
     * Layer 3 — Heuristic keyword-based detection
     */
    private heuristicParse(chatId: number, text: string): ParsedIntent | null {
        const lower = text.toLowerCase().trim();

        // ── Memory Context Check: Advanced Conversational Intents ──
        if (this.memoryStore) {
            // "send jack the usual amount"
            const usualAmountMatch = lower.match(/(?:send|pay)\s+([a-zA-Z0-9_]+)(?:\s+the)?\s+usual\s+amount/i);
            if (usualAmountMatch) {
                const vendor = usualAmountMatch[1];
                const avg = this.memoryStore.getAveragePayment(chatId, vendor);
                if (avg !== null) {
                    return {
                        action: "create_payment",
                        amount: parseFloat(avg.toFixed(2)),
                        beneficiary: vendor
                    };
                }
            }

            // "pay the last invoice" OR "pay that invoice"
            const lastInvoiceMatch = lower.match(/pay\s+(?:the\s+last|that|the)\s+invoice/i);
            if (lastInvoiceMatch) {
                const lastInvoice = this.memoryStore.getLastInvoice(chatId);
                if (lastInvoice) {
                    return {
                        action: "create_payment",
                        amount: lastInvoice.amount,
                        beneficiary: lastInvoice.vendor
                    };
                }
            }

            // "pay that aws invoice" or "pay aws invoice we saw earlier"
            if (lower.includes("pay") && lower.includes("invoice")) {
                const words = lower.replace(/[.,!?]/g, "").split(/\s+/);
                const vendorIdx = words.indexOf("pay") + 1;
                if (vendorIdx < words.length && vendorIdx > 0) {
                    let possibleVendor = words[vendorIdx];
                    if (possibleVendor === "that" || possibleVendor === "the") {
                        possibleVendor = words[vendorIdx + 1];
                    }
                    if (possibleVendor && possibleVendor !== "invoice") {
                        const invoice = this.memoryStore.getRecentInvoiceByVendor(chatId, possibleVendor);
                        if (invoice) {
                            return {
                                action: "create_payment",
                                amount: invoice.amount,
                                beneficiary: invoice.vendor
                            };
                        }
                    }
                }
            }
        }

        // ── Wallet creation ──
        if (this.matchesAny(lower, [
            "create wallet", "new wallet", "generate wallet",
            "make wallet", "setup wallet", "set up wallet",
            "i need a wallet", "i want a wallet",
            "create a wallet", "make a wallet",
            "give me a wallet", "get me a wallet",
        ])) {
            return { action: "create_wallet" };
        }

        // ── Show wallet / address ──
        if (this.matchesAny(lower, [
            "my wallet", "show wallet", "wallet", "my address",
            "show my address", "show address", "what is my address",
            "what's my address", "whats my address",
            "wallet address", "show my wallet",
            "where is my wallet", "display wallet",
            "display my address", "get my address",
        ])) {
            return { action: "show_wallet" };
        }

        // ── List vendors ──
        if (this.matchesAny(lower, [
            "list vendors", "show vendors", "my vendors",
            "show my vendors", "vendor list", "all vendors",
            "vendors", "list my vendors", "display vendors",
            "who are my vendors", "saved vendors",
        ])) {
            return { action: "list_vendors" };
        }

        // ── Analyze invoice ──
        if (this.containsAll(lower, ["invoice"]) && this.containsAny(lower, [
            "analyze", "parse", "read", "scan", "check", "process",
            "upload", "send", "submit", "extract", "review",
        ])) {
            return { action: "analyze_invoice" };
        }
        if (this.containsAll(lower, ["pdf"]) && this.containsAny(lower, [
            "analyze", "parse", "read", "scan", "check", "process",
            "can you", "upload", "send", "extract", "review",
        ])) {
            return { action: "analyze_invoice" };
        }
        if (this.matchesAny(lower, [
            "analyze this", "scan this", "read this",
            "check this document", "process this document",
        ])) {
            return { action: "analyze_invoice" };
        }

        // ── Reports ──
        if (/payment\s+history/i.test(lower)) {
            return { action: "payment_history" };
        }
        if (/monthly\s+spending/i.test(lower)) {
            return { action: "monthly_spending" };
        }
        if (this.containsAny(lower, ["report", "spending", "transaction history", "payment history"])) {
            return { action: "report" };
        }
        if (lower.includes("how much") && this.containsAny(lower, ["spend", "spent", "paid", "pay"])) {
            return { action: "report" };
        }
        if (this.matchesAny(lower, [
            "my transactions", "show transactions", "history",
            "show history", "transaction log", "payment log",
        ])) {
            return { action: "report" };
        }

        // ── Router Activity ──
        if (this.containsAny(lower, ["pending"]) && this.containsAny(lower, ["payment", "transfer", "transaction"])) {
            return { action: "show_pending_payments" };
        }
        if (this.containsAny(lower, ["router", "recent"]) && this.containsAny(lower, ["activity", "payment", "event", "transfer", "transaction"])) {
            return { action: "show_recent_payments" };
        }

        // ── Circle Wallet Intelligence ──
        if (this.containsAny(lower, ["wallet", "circle"]) && this.containsAny(lower, ["status", "balance", "data", "intelligence"])) {
            return { action: "wallet_intelligence" };
        }
        if (this.matchesAny(lower, [
            "check balance", "show balance", "what's my balance", "whats my balance", "my balance", "balance"
        ])) {
            return { action: "wallet_intelligence" };
        }

        // ── Status / fallback (if not specific to wallet intelligence) ──
        if (this.matchesAny(lower, [
            "status", "account", "my status", "account status",
            "account info", "account details",
        ])) {
            return { action: "status" };
        }

        // ── Export wallet ──
        if (this.containsAny(lower, ["export", "backup"]) && this.containsAny(lower, [
            "wallet", "key", "keys", "private", "seed", "phrase",
        ])) {
            return { action: "export_wallet" };
        }

        // ── Payment request ──
        if (this.containsAll(lower, ["request"]) && this.containsAny(lower, ["payment", "money", "usdc"])) {
            return { action: "create_payment_request" };
        }
        if (lower.includes("payment link") || lower.includes("pay link") || lower.includes("shareable link")) {
            return { action: "create_payment_request" };
        }

        // ── Greetings ──
        if (this.matchesAny(lower, [
            "hello", "hi", "hey", "good morning", "good evening",
            "good afternoon", "sup", "yo", "howdy",
            "what can you do", "what do you do",
            "help me", "i need help", "how does this work",
            "how do i use this", "what are your features",
            "features", "commands", "menu",
        ])) {
            return {
                action: "greeting",
                message: this.getGreetingMessage()
            };
        }

        // ── Acknowledgments ──
        if (this.matchesAny(lower, [
            "thanks", "thank you", "thx", "ty",
            "bye", "goodbye", "see you", "later",
            "cheers", "cool", "great", "awesome", "nice",
            "ok", "okay", "got it", "understood",
        ])) {
            return {
                action: "acknowledgment",
                message: "You're welcome! Let me know if you need anything else. 😊"
            };
        }

        return null;
    }

    // ── Helper matchers ──

    private matchesAny(text: string, patterns: string[]): boolean {
        return patterns.some(p => text === p);
    }

    private containsAny(text: string, keywords: string[]): boolean {
        return keywords.some(k => text.includes(k));
    }

    private containsAll(text: string, keywords: string[]): boolean {
        return keywords.every(k => text.includes(k));
    }

    private getGreetingMessage(): string {
        return `👋 Hey there! I'm ArcPay Agent — your AI payment assistant for Arc Network.

Here's what I can do:

💳 *Send payments* — "send 5 usdc jack"
📋 *Manage vendors* — "save vendor jack 0x..."
🔗 *Payment links* — "request 10 usdc"
📄 *Invoice analysis* — Send me a PDF or photo
👛 *Wallet* — "create wallet" or "my wallet"

Type /help for the full command list!`;
    }

    /**
     * Layer 4 — LLM with full conversation context
     */
    private async llmFallback(chatId: number, input: string): Promise<ParsedIntent> {
        if (!this.llmKeyStore) {
            return this.buildSmartFallback(chatId, input);
        }

        const auth = this.llmKeyStore.getKey(chatId);
        if (!auth) {
            return this.buildSmartFallback(chatId, input);
        }

        try {
            // Build messages with conversation history + context
            let memoryContext = "";
            if (this.memoryStore) {
                memoryContext = "\n\n" + this.memoryStore.getMemorySummary(chatId);
            }
            const systemContent = SYSTEM_PROMPT + (this.memory ? this.memory.buildContextSummary(chatId) : "") + memoryContext;
            const messages: { role: string; content: string }[] = [
                { role: "system", content: systemContent }
            ];

            // Add recent conversation history for context
            if (this.memory) {
                const history = this.memory.getHistory(chatId);
                const recent = history.slice(-10);
                for (const msg of recent) {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }

            messages.push({ role: "user", content: input });

            let apiUrl = "https://api.openai.com/v1/chat/completions";
            let model = auth.model || "gpt-4o-mini";

            // Support different providers
            if (auth.provider === "deepseek") {
                apiUrl = "https://api.deepseek.com/v1/chat/completions";
                model = auth.model || "deepseek-chat";
            } else if (auth.provider === "groq") {
                apiUrl = "https://api.groq.com/openai/v1/chat/completions";
                model = auth.model || "llama-3.3-70b-versatile";
            } else if (auth.provider === "qwen") {
                apiUrl = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
                model = auth.model || "qwen3-max";
            }

            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${auth.key}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    response_format: { type: "json_object" }
                })
            });

            if (response.ok) {
                const data = await response.json();
                let content = data.choices?.[0]?.message?.content;
                if (content) {
                    // Strip markdown json fences (```json ... ```) which LLMs often add
                    content = content.replace(/```json/i, "").replace(/```/g, "").trim();
                    try {
                        const parsed = JSON.parse(content);
                        if (parsed.action) {
                            console.log(`\n--- [LLM DEBUG] ---------------------`);
                            console.log(`Chat ID : ${chatId}`);
                            console.log(`User Msg: "${input}"`);
                            console.log(`Model   : ${model}`);
                            console.log(`Action  : ${parsed.action}`);
                            if (parsed.message) console.log(`Message : "${parsed.message}"`);
                            if (parsed.beneficiary) console.log(`Vendor  : ${parsed.beneficiary}`);
                            if (parsed.amount) console.log(`Amount  : ${parsed.amount}`);
                            console.log(`-------------------------------------\n`);

                            return {
                                action: parsed.action,
                                amount: parsed.amount,
                                beneficiary: parsed.beneficiary,
                                name: parsed.name,
                                address: parsed.address,
                                message: parsed.message,
                                input
                            };
                        }
                    } catch (parseErr) {
                        console.error("[LLM] JSON parse error:", parseErr, "Content was:", content);
                    }
                }
            } else {
                const errorBody = await response.text();
                console.error(`[LLM] API error ${response.status}: ${errorBody.substring(0, 200)}`);
            }
        } catch (err) {
            console.error("[LLM] Error:", err);
        }

        // LLM failed → fall back to heuristic, then smart fallback
        const heuristicResult = this.heuristicParse(chatId, input);
        if (heuristicResult) return heuristicResult;
        return this.buildSmartFallback(chatId, input);
    }

    /**
     * Smart fallback — contextual help based on keywords and conversation context
     */
    private buildSmartFallback(chatId: number, input: string): ParsedIntent {
        const lower = input.toLowerCase();

        // Check if user is referencing previous context
        if (this.memory) {
            const ctx = this.memory.getContext(chatId);

            // "pay that" / "pay it" without a match in follow-ups — show what we know
            if (this.containsAny(lower, ["pay", "send"]) && this.containsAny(lower, ["that", "it", "this"])) {
                if (ctx.lastInvoice?.amount) {
                    return {
                        action: "create_payment",
                        amount: parseFloat(ctx.lastInvoice.amount),
                        beneficiary: ctx.lastInvoice.vendor || "Unknown",
                        message: `Preparing payment from your last invoice: ${ctx.lastInvoice.amount} ${ctx.lastInvoice.currency || "USDC"} to ${ctx.lastInvoice.vendor}.`
                    };
                }
            }
        }

        // Payment-related
        if (this.containsAny(lower, ["send", "pay", "transfer", "payment"])) {
            return {
                action: "unknown",
                input,
                message: `I think you want to send a payment! Try:\n\n• \`send 5 usdc jack\`\n• \`pay 10 usdc to 0xabc...\`\n\nMake sure to include the amount and recipient.`
            };
        }

        // Vendor-related
        if (this.containsAny(lower, ["vendor", "contact", "address book", "save"])) {
            return {
                action: "unknown",
                input,
                message: `Looking to manage vendors? Try:\n\n• \`save vendor jack 0xabc...\`\n• \`list vendors\``
            };
        }

        // Wallet-related
        if (this.containsAny(lower, ["wallet", "address", "key", "account"])) {
            return {
                action: "unknown",
                input,
                message: `Need wallet help? Try:\n\n• \`create wallet\` — Generate a new wallet\n• \`my wallet\` — Show your address\n• \`status\` — Check your balance`
            };
        }

        // Invoice-related
        if (this.containsAny(lower, ["invoice", "pdf", "document", "receipt", "bill"])) {
            return {
                action: "unknown",
                input,
                message: `Want to analyze an invoice? Just send me the file directly as a PDF document or photo, and I'll extract the payment details automatically! 📄`
            };
        }

        // Generic fallback — but still helpful
        return {
            action: "unknown",
            input,
            message: `I'm not sure what you mean, but here's what I can do:\n\n💳 \`send 5 usdc jack\` — Send payment\n📋 \`save vendor jack 0x...\` — Save vendor\n🔗 \`request 10 usdc\` — Payment link\n📄 Send a PDF — Invoice analysis\n👛 \`create wallet\` — New wallet\n\nType /help for all commands!`
        };
    }

    private buildPlan(intent: ParsedIntent): string[] | undefined {
        switch (intent.action) {
            case "create_payment":
                return ["Verify recipient (vendor/address)", "Prepare amount", "Ask user to confirm", "Send payment request"];
            case "analyze_invoice":
                return ["Receive document", "Extract fields", "Show summary", "Offer to prepare payment"];
            case "payment_history":
            case "show_recent_payments":
                return ["Get wallet address", "Scan records", "List recent transactions"];
            case "wallet_intelligence":
                return ["Find wallet", "Read balance and recent tx", "Send concise summary"];
            case "report":
                return ["Get wallet address", "Aggregate spending", "Summarize by vendor/time"];
            case "status":
            case "greeting":
            case "acknowledgment":
                return ["Send response to user"];
            default:
                return ["Gather details", "Execute requested action"];
        }
    }
}

function ethersLikeAddress(value: string): boolean {
    return /^0[xX][a-fA-F0-9]{40}$/.test(value);
}
