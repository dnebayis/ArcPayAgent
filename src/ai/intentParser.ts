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
    period?: string;
}

interface LLMAuthConfig {
    provider: string;
    key: string;
    model?: string;
}

interface OpenAICompatibleConfig {
    apiUrl: string;
    model: string;
    extraHeaders?: Record<string, string>;
}

function extractEntity(match: RegExpMatchArray, ...indexes: number[]): string {
    for (const index of indexes) {
        const value = match[index];
        if (value) {
            return value.trim();
        }
    }
    return "";
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

        const accountSummaryPattern = /^(?:(?:show|get|check)\s+)?(?:my\s+)?(?:account\s+summary|account\s+overview|dashboard)$/i;
        if (accountSummaryPattern.test(text)) return { action: "account_summary" };


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

        const explicitScheduleNoTimePattern = /^schedule\s+payment\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)$/i;
        const explicitScheduleNoTimeMatch = text.match(explicitScheduleNoTimePattern);
        if (explicitScheduleNoTimeMatch) {
            return {
                action: "schedule_payment",
                amount: parseFloat(explicitScheduleNoTimeMatch[1]),
                beneficiary: explicitScheduleNoTimeMatch[2]
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
        const sendPattern1 = /^send\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?(?:"([^"]+)"|(.+))$/i;
        const m1 = text.match(sendPattern1);
        if (m1) return { action: "create_payment", amount: parseFloat(m1[1]), beneficiary: extractEntity(m1, 2, 3) };

        // 0xabc... send 1 usdc
        const sendPattern2 = /^(0[xX][a-fA-F0-9]{40})\s+send\s+(\d+(?:\.\d+)?)\s+usdc$/i;
        const m2 = text.match(sendPattern2);
        if (m2) return { action: "create_payment", amount: parseFloat(m2[2]), beneficiary: m2[1] };

        // pay 10 usdc to jack
        const payPattern = /^pay\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?(?:"([^"]+)"|(.+))$/i;
        const mp = text.match(payPattern);
        if (mp) return { action: "create_payment", amount: parseFloat(mp[1]), beneficiary: extractEntity(mp, 2, 3) };

        // transfer 5 usdc to jack
        const transferPattern = /^transfer\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?(?:"([^"]+)"|(.+))$/i;
        const mt = text.match(transferPattern);
        if (mt) return { action: "create_payment", amount: parseFloat(mt[1]), beneficiary: extractEntity(mt, 2, 3) };

        const sendAmountOnly = /^(?:send|pay|transfer)\s+(\d+(?:\.\d+)?)\s*(?:usdc)?$/i;
        const mAmountOnly = text.match(sendAmountOnly);
        if (mAmountOnly) return { action: "create_payment", amount: parseFloat(mAmountOnly[1]) };

        // send jack / pay jack (no amount) -> ask for amount, keep beneficiary
        const sendNoAmount1 = /^(?:send|pay)\s+([a-zA-Z0-9_x]+)$/i;
        const mNoAmt1 = text.match(sendNoAmount1);
        if (mNoAmt1 && !/^\d+(?:\.\d+)?$/.test(mNoAmt1[1])) return { action: "create_payment", beneficiary: mNoAmt1[1] };

        // save vendor jack 0xabc...
        const vendorPattern = /^(?:save|add)\s+vendor\s+(?:"([^"]+)"|([a-zA-Z0-9_]+))\s+(0[xX][a-fA-F0-9]{40})/i;
        const mv = text.match(vendorPattern);
        if (mv) return { action: "save_vendor", name: mv[1] || mv[2], address: mv[3] };

        // create payment request 20 usdc | request 5 usdc
        const reqPattern = /^(?:create\s+)?(?:payment\s+)?request\s+(\d+(?:\.\d+)?)\s+usdc/i;
        const mr = text.match(reqPattern);
        if (mr) return { action: "create_payment_request", amount: parseFloat(mr[1]) };

        // remove vendor jack | delete vendor jack
        const removeVendorPattern = /^(?:remove|delete)\s+vendor\s+(?:"([^"]+)"|(.+))$/i;
        const mrv = text.match(removeVendorPattern);
        if (mrv) return { action: "remove_vendor", name: (mrv[1] || mrv[2]).trim() };

        // remove all vendors | delete all vendors | clear vendors
        const removeAllPattern = /^(?:remove|delete|clear)\s+all\s+vendors?/i;
        if (removeAllPattern.test(text)) return { action: "remove_all_vendors" };

        // vendor aws | vendor detail jack
        const vendorDetailPattern = /^vendor\s+(?:detail\s+)?(?:"([^"]+)"|(.+))$/i;
        const mvd = text.match(vendorDetailPattern);
        if (mvd) return { action: "vendor_detail", name: (mvd[1] || mvd[2]).trim() };

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
            const description = this.memory.describeLastInvoice(chatId);
            const msg = description
                ? `${description}\n\nWould you like me to prepare the payment?`
                : "I analyzed an invoice recently. Want me to prepare the payment?";
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

        const lastPaymentQuery = /^(who\s+did\s+i\s+(?:just\s+)?(?:pay|send(?:\s+money)?)\s*(?:to)?|what\s+did\s+i\s+(?:just\s+)?pay|what\s+was\s+my\s+last\s+payment|who\s+was\s+my\s+last\s+payment\s+to)$/i;
        if (lastPaymentQuery.test(lower) && ctx.lastPayment) {
            return {
                action: "chat",
                message: this.memory.describeLastPayment(chatId) || "I have your last payment in memory, but I couldn't summarize it cleanly."
            };
        }

        const lastPaymentAmountQuery = /^(how\s+much\s+was\s+my\s+last\s+payment|what\s+was\s+the\s+last\s+payment\s+amount|what\s+amount\s+did\s+i\s+(?:just\s+)?pay)$/i;
        if (lastPaymentAmountQuery.test(lower) && ctx.lastPayment) {
            return {
                action: "chat",
                message: this.memory.describeLastPaymentAmount(chatId) || "I know there was a recent payment, but I couldn't read the amount cleanly."
            };
        }

        const lastInvoiceQuery = /^(what\s+invoice\s+did\s+we\s+(?:just\s+)?analy[sz]e|which\s+invoice\s+did\s+we\s+(?:just\s+)?analy[sz]e|who\s+was\s+that\s+invoice\s+from|what\s+was\s+the\s+last\s+invoice)$/i;
        if (lastInvoiceQuery.test(lower) && ctx.lastInvoice) {
            return {
                action: "chat",
                message: this.memory.describeLastInvoice(chatId) || "I analyzed an invoice recently, but I couldn't summarize it cleanly."
            };
        }

        const lastInvoiceAmountQuery = /^(how\s+much\s+was\s+that\s+invoice|what\s+was\s+the\s+invoice\s+amount|what\s+amount\s+was\s+the\s+last\s+invoice)$/i;
        if (lastInvoiceAmountQuery.test(lower) && ctx.lastInvoice) {
            return {
                action: "chat",
                message: this.memory.describeLastInvoiceAmount(chatId) || "I know there was a recent invoice, but I couldn't read the amount cleanly."
            };
        }

        const lastActivityQuery = /^(what\s+did\s+we\s+(?:just\s+)?do|what\s+was\s+the\s+last\s+thing\s+we\s+did|what\s+did\s+you\s+just\s+do)$/i;
        if (lastActivityQuery.test(lower)) {
            const activity = this.memory.getLastActivity(chatId);
            if (activity) {
                return {
                    action: "chat",
                    message: `The last thing we did was: ${activity.summary}`
                };
            }
        }

        return null;
    }

    private resolveSessionFollowUp(chatId: number, text: string): ParsedIntent | null {
        if (!this.sessionStore) return null;

        const session = this.sessionStore.getSession(chatId);
        const lower = text.toLowerCase().trim();
        const amountOnlyMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:usd|usdc)?$/i);
        const recipientReplyMatch = lower.match(/^(?:to\s+|use\s+)?([a-zA-Z0-9_]+)(?:\s+instead)?$/i);

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
            if (amountMatch || amountOnlyMatch) {
                const newAmount = parseFloat((amountMatch?.[1] || amountOnlyMatch?.[1]) as string);
                this.sessionStore.updatePendingPayment(chatId, { amount: newAmount });
                return {
                    action: "update_payment_amount",
                    amount: newAmount,
                    beneficiary: session.pendingPayment.vendor || session.lastVendor || "Unknown"
                };
            }

            // Handle vendor modifications: "use the same vendor", "change to jack"
            // Though changing vendor is slightly more complex, we can handle basic updates
            const changeVendorMatch = /(?:change\s+to|use|send\s+to)\s+([a-zA-Z0-9_x]+)/i;
            const vendorMatch = lower.match(changeVendorMatch);
            // Ignore if it matches numbers (meaning it was an amount change, handled above)
            if ((vendorMatch || recipientReplyMatch) && !/^\d+(?:\.\d+)?$/.test((vendorMatch?.[1] || recipientReplyMatch?.[1]) as string)) {
                let newVendor = (vendorMatch?.[1] || recipientReplyMatch?.[1]) as string;
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

            if (pendingIntent.action === "create_payment") {
                if (amountOnlyMatch && pendingIntent.beneficiary) {
                    const newAmount = parseFloat(amountOnlyMatch[1]);
                    return {
                        action: "create_payment",
                        amount: newAmount,
                        beneficiary: pendingIntent.beneficiary
                    };
                }

                if (recipientReplyMatch && pendingIntent.amount !== undefined) {
                    return {
                        action: "create_payment",
                        amount: pendingIntent.amount,
                        beneficiary: recipientReplyMatch[1]
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

                if (recipientReplyMatch && pendingIntent.amount !== undefined && pendingIntent.schedule_time) {
                    return {
                        action: "schedule_payment",
                        amount: pendingIntent.amount,
                        beneficiary: recipientReplyMatch[1],
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

        if (this.memory) {
            if (this.matchesAny(lower, [
                "what next",
                "what should i do next",
                "what can i do next",
                "what now",
                "what should we do next",
            ])) {
                const ctx = this.memory.getContext(chatId);
                return {
                    action: "chat",
                    message: this.getNextStepMessage(ctx.lastAction)
                };
            }

            const asksForTodaySummary =
                (lower.includes("today") || lower.includes("so far")) &&
                ((lower.includes("what did we do")) ||
                 (lower.includes("what have we done")) ||
                 (lower.includes("what did i do")) ||
                 (lower.includes("what have i done")) ||
                 (lower.includes("what happened")) ||
                 (lower.includes("what did we work on")));

            if (asksForTodaySummary) {
                const summary = this.memory.summarizeToday(chatId);
                return {
                    action: "chat",
                    message: summary || "We haven't completed any recorded actions today yet. Ask me to create a wallet, send a payment, analyze an invoice, or schedule something."
                };
            }
        }

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

        if (this.matchesAny(lower, [
            "account summary", "account overview", "dashboard", "show dashboard", "show account summary"
        ])) {
            return { action: "account_summary" };
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

💳 *Send payments* — "send 5 usdc to jack"
📋 *Manage vendors* — "save vendor jack 0x..."
🔗 *Payment links* — "request 10 usdc"
📄 *Invoice analysis* — Send me a PDF or photo
👛 *Wallet* — "create wallet" or "my wallet"

Type /help for the full command list!`;
    }

    private getNextStepMessage(lastAction?: string): string {
        switch (lastAction) {
            case "create_wallet":
                return "Your wallet is ready. Next, you can save a vendor with `save vendor jack 0x...` or check `wallet balance`.";
            case "show_wallet":
            case "wallet_intelligence":
            case "status":
                return "Next, you can save a vendor, send a payment, or ask for `payment history`.";
            case "save_vendor":
            case "list_vendors":
            case "vendor_detail":
            case "top_vendors":
                return "Next, you can pay a saved vendor with `send 5 usdc to jack` or create a schedule.";
            case "analyze_invoice":
                return "If the invoice looks correct, you can say `pay that invoice` or save the vendor first.";
            case "create_payment":
                return "Next, you can confirm the payment, update the amount, or cancel it.";
            case "schedule_payment":
            case "list_schedules":
                return "Next, you can review schedules with `list schedules` or cancel one with `cancel schedule <id>`.";
            case "payment_history":
            case "show_recent_payments":
            case "show_pending_payments":
            case "report":
            case "monthly_spending":
            case "spending_by_vendor":
                return "Next, you can ask for another report, check your wallet, or send a payment.";
            default:
                return "You can create a wallet, save a vendor, send a payment, analyze an invoice, or schedule a payment. Type /help for examples.";
        }
    }

    /**
     * Layer 4 — LLM with full conversation context
     */
    private getOpenAICompatibleConfig(auth: LLMAuthConfig): OpenAICompatibleConfig {
        switch (auth.provider) {
            case "deepseek":
                return { apiUrl: "https://api.deepseek.com/v1/chat/completions", model: auth.model || "deepseek-chat" };
            case "groq":
                return { apiUrl: "https://api.groq.com/openai/v1/chat/completions", model: auth.model || "llama-3.3-70b-versatile" };
            case "qwen":
                return { apiUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", model: auth.model || "qwen3-max" };
            case "openrouter":
                return { apiUrl: "https://openrouter.ai/api/v1/chat/completions", model: auth.model || "openai/gpt-4o-mini" };
            case "together":
                return { apiUrl: "https://api.together.xyz/v1/chat/completions", model: auth.model || "meta-llama/Llama-3.3-70B-Instruct-Turbo" };
            case "mistral":
                return { apiUrl: "https://api.mistral.ai/v1/chat/completions", model: auth.model || "mistral-small-latest" };
            case "openai":
            default:
                return { apiUrl: "https://api.openai.com/v1/chat/completions", model: auth.model || "gpt-4o-mini" };
        }
    }

    private async callOpenAICompatibleLLM(auth: LLMAuthConfig, messages: { role: string; content: string }[]): Promise<{ model: string; content: string | undefined } | null> {
        const config = this.getOpenAICompatibleConfig(auth);
        const response = await fetch(config.apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${auth.key}`,
                ...(config.extraHeaders || {})
            },
            body: JSON.stringify({
                model: config.model,
                messages,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[LLM] API error ${response.status}: ${errorBody.substring(0, 200)}`);
            return null;
        }

        const data = await response.json();
        return { model: config.model, content: data.choices?.[0]?.message?.content };
    }

    private async callAnthropicLLM(auth: LLMAuthConfig, systemContent: string, messages: { role: string; content: string }[]): Promise<{ model: string; content: string | undefined } | null> {
        const model = auth.model || "claude-3-5-sonnet-latest";
        const anthropicMessages = messages
            .filter((msg) => msg.role !== "system")
            .map((msg) => ({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: msg.content
            }));

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": auth.key,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model,
                system: `${systemContent}\n\nReturn only valid JSON.`,
                max_tokens: 800,
                messages: anthropicMessages
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[LLM] API error ${response.status}: ${errorBody.substring(0, 200)}`);
            return null;
        }

        const data = await response.json();
        const content = data.content?.find((item: any) => item?.type === "text")?.text;
        return { model, content };
    }

    private async callGeminiLLM(auth: LLMAuthConfig, systemContent: string, messages: { role: string; content: string }[]): Promise<{ model: string; content: string | undefined } | null> {
        const model = auth.model || "gemini-2.0-flash";
        const geminiMessages = messages
            .filter((msg) => msg.role !== "system")
            .map((msg) => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }]
            }));

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": auth.key
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: `${systemContent}\n\nReturn only valid JSON.` }]
                },
                contents: geminiMessages,
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[LLM] API error ${response.status}: ${errorBody.substring(0, 200)}`);
            return null;
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.find((item: any) => typeof item?.text === "string")?.text;
        return { model, content };
    }

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

            let model = auth.model || "gpt-4o-mini";
            let llmResult: { model: string; content: string | undefined } | null;
            if (auth.provider === "anthropic") {
                llmResult = await this.callAnthropicLLM(auth, systemContent, messages);
            } else if (auth.provider === "gemini") {
                llmResult = await this.callGeminiLLM(auth, systemContent, messages);
            } else {
                llmResult = await this.callOpenAICompatibleLLM(auth, messages);
            }

            if (llmResult) {
                model = llmResult.model;
                let content = llmResult.content;
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
                message: `I think you want to send a payment. Try:\n\n• \`send 5 usdc to jack\`\n• \`pay 10 usdc to 0xabc...\`\n\nMake sure to include the amount and recipient.`
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
                message: `Need wallet help? Try:\n\n• \`create wallet\` — Create a new wallet\n• \`show wallet\` — Show your address\n• \`wallet balance\` — Show balance and activity`
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
            message: `I'm not sure what you mean, but here's what I can do:\n\n💳 \`send 5 usdc to jack\` — Send a payment\n📋 \`save vendor jack 0x...\` — Save a vendor\n🔗 \`request 10 usdc\` — Create a payment link\n📄 Send a PDF — Analyze an invoice\n👛 \`create wallet\` — Create a wallet\n\nType /help for the full command list.`
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
            case "account_summary":
                return ["Read wallet", "Aggregate recent account metrics", "Send concise account overview"];
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
