/**
 * Per-user conversation memory and context tracker.
 * Remembers recent messages, last actions, and pending context.
 */

import { loadStore, saveStore } from "../storage/persistence";
import { EpisodicMemory } from "./episodicMemory";

export type FlowStateName = "idle" | "payment_awaiting_confirmation" | "invoice_awaiting_override";

export interface FlowState {
    name: FlowStateName;
    since: number;
    paymentId?: string;
}

export interface ConversationContext {
    /** Last invoice that was analyzed */
    lastInvoice?: {
        vendor: string | null;
        amount: string | null;
        currency: string | null;
        detectedAmount?: string | null;
        detectedCurrency?: string | null;
        settlementAmount?: string | null;
        settlementCurrency?: string | null;
        invoiceNumber: string | null;
        riskLevel?: "safe" | "review" | "high_risk";
        riskFlags?: string[];
    };
    /** Last payment that was prepared or sent */
    lastPayment?: {
        beneficiary: string;
        amount: string;
        token?: "USDC" | "EURC";
    };
    /** Last schedule that was prepared or created */
    lastSchedule?: {
        id?: string;
        beneficiary: string;
        amount: string;
        scheduledFor?: number;
    };
    /** Last vendor that was looked up or saved */
    lastVendor?: {
        name: string;
        address?: string;
    };
    /** Last action the bot took */
    lastAction?: string;
    /** Explicit flow state for the current conversation turn */
    flowState?: FlowState;
    /** User's language code from Telegram (e.g. "tr", "en", "de") */
    language?: string;
    /** Recent conversation messages (max 20) */
    messages: { role: "user" | "assistant"; content: string }[];
}

interface PersistedCtx {
    lastAction?: string;
    lastPayment?: ConversationContext["lastPayment"];
    lastInvoice?: ConversationContext["lastInvoice"];
    lastSchedule?: ConversationContext["lastSchedule"];
    lastVendor?: ConversationContext["lastVendor"];
    flowState?: FlowState;
    language?: string;
}

const MAX_MESSAGES = 30;
/** When the buffer hits this size, oldest messages are compressed into a summary line. */
const SUMMARIZE_THRESHOLD = 30;
const SUMMARIZE_KEEP = 20;

export class ConversationMemory {
    private memory: Record<string, ConversationContext> = {};
    private readonly episodic: EpisodicMemory;

    constructor() {
        const raw = loadStore<Record<string, PersistedCtx>>("conv_contexts.json");
        // Pre-populate in-memory store from persisted data
        for (const [id, persisted] of Object.entries(raw)) {
            this.memory[id] = { messages: [], ...persisted };
        }
        this.episodic = new EpisodicMemory();
    }

    private persist(): void {
        const toSave: Record<string, PersistedCtx> = {};
        for (const [id, ctx] of Object.entries(this.memory)) {
            toSave[id] = {
                lastAction: ctx.lastAction,
                lastPayment: ctx.lastPayment,
                lastInvoice: ctx.lastInvoice,
                lastSchedule: ctx.lastSchedule,
                lastVendor: ctx.lastVendor,
                flowState: ctx.flowState,
                language: ctx.language,
            };
        }
        saveStore("conv_contexts.json", toSave);
    }

    private ensure(chatId: number): ConversationContext {
        const id = chatId.toString();
        if (!this.memory[id]) {
            this.memory[id] = { messages: [] };
        }
        return this.memory[id];
    }

    /** Add a user message to history */
    addUserMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "user", content: text });
        this.compressIfNeeded(ctx);
    }

    /** Add a bot response to history */
    addBotMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "assistant", content: text });
        this.compressIfNeeded(ctx);
    }

    /**
     * When the message buffer is full, replace the oldest batch with a single
     * deterministic summary line — no LLM call needed.
     */
    private compressIfNeeded(ctx: ConversationContext): void {
        if (ctx.messages.length <= SUMMARIZE_THRESHOLD) return;

        const toCompress = ctx.messages.slice(0, SUMMARIZE_THRESHOLD - SUMMARIZE_KEEP);
        const summary = this.buildSummaryLine(ctx);
        ctx.messages = [
            { role: "assistant", content: `[Session context: ${summary}]` },
            ...ctx.messages.slice(toCompress.length)
        ];
    }

    /**
     * Build a compact, deterministic summary string from the current context fields.
     * Used as the compression artefact so older turns are not lost entirely.
     */
    private buildSummaryLine(ctx: ConversationContext): string {
        const parts: string[] = [];
        if (ctx.lastPayment) {
            const tok = ctx.lastPayment.token ?? "USDC";
            parts.push(`last payment: ${ctx.lastPayment.amount} ${tok} to ${ctx.lastPayment.beneficiary}`);
        }
        if (ctx.lastSchedule) {
            parts.push(`last schedule: ${ctx.lastSchedule.amount} USDC to ${ctx.lastSchedule.beneficiary}`);
        }
        if (ctx.lastVendor) {
            parts.push(`last vendor: ${ctx.lastVendor.name}`);
        }
        if (ctx.lastInvoice?.vendor) {
            parts.push(`last invoice: ${ctx.lastInvoice.vendor} ${ctx.lastInvoice.settlementAmount ?? ctx.lastInvoice.amount} USDC`);
        }
        return parts.length > 0 ? parts.join("; ") : "earlier conversation compressed";
    }

    /** Store the last analyzed invoice */
    setLastInvoice(chatId: number, invoice: ConversationContext["lastInvoice"]): void {
        const ctx = this.ensure(chatId);
        ctx.lastInvoice = invoice;
        ctx.lastAction = "analyze_invoice";
        this.persist();
    }

    /** Store the last payment prepared */
    setLastPayment(chatId: number, beneficiary: string, amount: string, token?: "USDC" | "EURC"): void {
        const ctx = this.ensure(chatId);
        ctx.lastPayment = { beneficiary, amount, token };
        ctx.lastAction = "create_payment";
        this.persist();
    }

    /** Store the last schedule prepared */
    setLastSchedule(chatId: number, beneficiary: string, amount: string, scheduledFor?: number, id?: string): void {
        const ctx = this.ensure(chatId);
        ctx.lastSchedule = { id, beneficiary, amount, scheduledFor };
        ctx.lastAction = "schedule_payment";
        this.persist();
    }

    setLanguage(chatId: number, lang: string): void {
        if (!lang) return;
        this.ensure(chatId).language = lang;
        this.persist();
    }

    setLastVendor(chatId: number, name: string, address?: string): void {
        const ctx = this.ensure(chatId);
        ctx.lastVendor = { name, address };
        ctx.lastAction = "vendor_detail";
        this.persist();
    }

    /** Set lastAction */
    setLastAction(chatId: number, action: string): void {
        this.ensure(chatId).lastAction = action;
        this.persist();
    }

    setFlowState(chatId: number, state: FlowState): void {
        this.ensure(chatId).flowState = state;
        this.persist();
    }

    getFlowState(chatId: number): FlowState | undefined {
        return this.ensure(chatId).flowState;
    }

    clearFlowState(chatId: number): void {
        this.ensure(chatId).flowState = undefined;
        this.persist();
    }

    /**
     * Clear only the transient action/payment/invoice/schedule/vendor context.
     * Preserves conversation history and language preference.
     * Call this after a payment resolves (confirmed / cancelled / failed) so
     * orchestrator guards don't misfire on the next message.
     */
    clearTemporaryContext(chatId: number): void {
        const ctx = this.ensure(chatId);
        ctx.lastAction = undefined;
        ctx.lastPayment = undefined;
        ctx.lastInvoice = undefined;
        ctx.lastSchedule = undefined;
        ctx.lastVendor = undefined;
        this.clearFlowState(chatId);
        this.persist();
    }

    /** Get full context for the user */
    getContext(chatId: number): ConversationContext {
        return this.ensure(chatId);
    }

    /**
     * Full reset — wipes all memory including message history.
     * Used by /reset command.
     */
    clearContext(chatId: number): void {
        const id = chatId.toString();
        delete this.memory[id];
        this.episodic.closeActiveSession(chatId);
        this.persist();
    }

    /** Get conversation history formatted for LLM */
    getHistory(chatId: number): { role: "user" | "assistant"; content: string }[] {
        return this.ensure(chatId).messages;
    }

    /** Record an episodic event for the user */
    recordEpisodicEvent(chatId: number, event: string): void {
        this.episodic.record(chatId, event);
    }

    /** Build a context summary string for the LLM */
    buildContextSummary(chatId: number): string {
        const ctx = this.ensure(chatId);
        const parts: string[] = [];

        // Language hint — only emit when non-English so the LLM defaults to English normally
        if (ctx.language && !ctx.language.startsWith("en")) {
            parts.push(`[User language: ${ctx.language} — reply in this language]`);
        }

        // Always provide current date/time (human-readable)
        const now = new Date();
        const dateStr = now.toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short"
        });
        parts.push(`[Current date/time: ${dateStr}]`);

        if (ctx.lastInvoice) {
            const detected = ctx.lastInvoice.detectedAmount && ctx.lastInvoice.detectedCurrency
                ? `${ctx.lastInvoice.detectedAmount} ${ctx.lastInvoice.detectedCurrency}`
                : `${ctx.lastInvoice.amount} ${ctx.lastInvoice.currency}`;
            const settlement = ctx.lastInvoice.settlementAmount && ctx.lastInvoice.settlementCurrency
                ? `${ctx.lastInvoice.settlementAmount} ${ctx.lastInvoice.settlementCurrency}`
                : `${ctx.lastInvoice.amount} ${ctx.lastInvoice.currency}`;
            const flagsInfo = ctx.lastInvoice.riskFlags?.length ? `, flags=[${ctx.lastInvoice.riskFlags.join(", ")}]` : "";
            const riskInfo = ctx.lastInvoice.riskLevel ? `, risk="${ctx.lastInvoice.riskLevel}"${flagsInfo}` : "";
            parts.push(`[Last analyzed invoice: vendor="${ctx.lastInvoice.vendor}", detected="${detected}", settlement="${settlement}", invoiceNumber="${ctx.lastInvoice.invoiceNumber}"${riskInfo}]`);
        }
        if (ctx.lastPayment) {
            const payToken = ctx.lastPayment.token ?? "USDC";
            parts.push(`[Last payment: ${ctx.lastPayment.amount} ${payToken} to ${ctx.lastPayment.beneficiary}]`);
        }
        if (ctx.lastSchedule) {
            const when = ctx.lastSchedule.scheduledFor ? new Date(ctx.lastSchedule.scheduledFor).toLocaleString("en-US") : "unknown time";
            parts.push(`[Last schedule: ${ctx.lastSchedule.amount} USDC to ${ctx.lastSchedule.beneficiary} at ${when}]`);
        }
        if (ctx.lastVendor) {
            parts.push(`[Last vendor: ${ctx.lastVendor.name}${ctx.lastVendor.address ? ` at ${ctx.lastVendor.address}` : ""}]`);
        }
        if (ctx.lastAction) {
            parts.push(`[Last action: ${ctx.lastAction}]`);
        }
        if (ctx.flowState && ctx.flowState.name !== "idle") {
            parts.push(`[Flow state: ${ctx.flowState.name}]`);
        }

        const episodicCtx = this.episodic.getContextString(chatId);
        if (episodicCtx) parts.push(episodicCtx);

        return "\n\nCurrent context:\n" + parts.join("\n");
    }
}
