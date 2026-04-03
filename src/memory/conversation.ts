import type { DB } from "../store/db";

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface FlowState {
    status: "idle" | "awaiting_amount" | "awaiting_confirmation";
    since?: number;
    token?: string;
    beneficiary?: string;
}

interface PersistedContext {
    lastPayment?: { beneficiary: string; amount: string; token: string };
    lastVendor?: { name: string; address: string };
    lastSchedule?: { id: string; beneficiary: string; amount: number };
    lastInvoice?: { vendor: string; amount: string; currency: string; invoiceNumber?: string };
}

interface ChatContext {
    messages: ChatMessage[];
    flowState: FlowState;
    lastAction?: string;
    lastPayment?: { beneficiary: string; amount: string; token: string };
    lastVendor?: { name: string; address: string };
    lastSchedule?: { id: string; beneficiary: string; amount: number };
    lastInvoice?: { vendor: string; amount: string; currency: string; invoiceNumber?: string };
    loaded: boolean; // has been loaded from DB
}

// Keep last N messages in DB — enough for continuity without bloat
const PERSIST_MESSAGES = 20;
const MAX_MESSAGES = 100;
const SUMMARIZE_THRESHOLD = 30;

export class ConversationMemory {
    private contexts = new Map<number, ChatContext>();
    private db: DB | null = null;

    constructor(db?: DB) {
        this.db = db ?? null;
    }

    private ensure(chatId: number): ChatContext {
        if (!this.contexts.has(chatId)) {
            this.contexts.set(chatId, {
                messages: [],
                flowState: { status: "idle" },
                loaded: false,
            });
        }
        return this.contexts.get(chatId)!;
    }

    /**
     * Load persisted messages + context from DB if not already loaded.
     * Call this before the first interaction in a new process lifecycle.
     */
    async load(chatId: number): Promise<void> {
        const ctx = this.ensure(chatId);
        if (ctx.loaded || !this.db) { ctx.loaded = true; return; }

        try {
            const row = await this.db.queryOne<any>(
                "SELECT messages, context FROM conversations WHERE chat_id=$1", [chatId]
            );
            if (row) {
                const msgs: ChatMessage[] = JSON.parse(row.messages);
                const persisted: PersistedContext = JSON.parse(row.context);
                ctx.messages = msgs;
                ctx.lastPayment = persisted.lastPayment;
                ctx.lastVendor = persisted.lastVendor;
                ctx.lastSchedule = persisted.lastSchedule;
                ctx.lastInvoice = persisted.lastInvoice;
            }
        } catch { /* non-fatal */ }

        ctx.loaded = true;
    }

    /** Fire-and-forget persist — does not block message flow. */
    private persist(chatId: number): void {
        if (!this.db) return;
        const ctx = this.contexts.get(chatId);
        if (!ctx) return;

        const messages = ctx.messages.slice(-PERSIST_MESSAGES);
        const context: PersistedContext = {
            lastPayment: ctx.lastPayment,
            lastVendor: ctx.lastVendor,
            lastSchedule: ctx.lastSchedule,
            lastInvoice: ctx.lastInvoice,
        };

        this.db.run(
            `INSERT INTO conversations (chat_id, messages, context, updated_at)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (chat_id) DO UPDATE SET messages=$2, context=$3, updated_at=$4`,
            [chatId, JSON.stringify(messages), JSON.stringify(context), Date.now()]
        ).catch(() => { /* non-fatal */ });
    }

    addUserMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "user", content: text });
        this.trim(ctx);
        this.persist(chatId);
    }

    addBotMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "assistant", content: text });
        this.trim(ctx);
        this.persist(chatId);
    }

    getHistory(chatId: number): ChatMessage[] {
        return this.ensure(chatId).messages.slice(-MAX_MESSAGES);
    }

    // --- Flow state (transient — not persisted) ---

    getFlowState(chatId: number): FlowState {
        return this.ensure(chatId).flowState;
    }

    setFlowState(chatId: number, state: FlowState): void {
        this.ensure(chatId).flowState = state;
    }

    clearFlowState(chatId: number): void {
        this.ensure(chatId).flowState = { status: "idle" };
    }

    // --- Context setters ---

    setLastAction(chatId: number, action: string): void {
        this.ensure(chatId).lastAction = action;
    }

    setLastPayment(chatId: number, beneficiary: string, amount: string, token: string): void {
        this.ensure(chatId).lastPayment = { beneficiary, amount, token };
        this.persist(chatId);
    }

    setLastVendor(chatId: number, name: string, address: string): void {
        this.ensure(chatId).lastVendor = { name, address };
        this.persist(chatId);
    }

    setLastSchedule(chatId: number, id: string, beneficiary: string, amount: number): void {
        this.ensure(chatId).lastSchedule = { id, beneficiary, amount };
        this.persist(chatId);
    }

    setLastInvoice(chatId: number, vendor: string, amount: string, currency: string, invoiceNumber?: string): void {
        this.ensure(chatId).lastInvoice = { vendor, amount, currency, invoiceNumber };
        this.persist(chatId);
    }

    getContext(chatId: number): ChatContext {
        return this.ensure(chatId);
    }

    // --- Context summary for LLM ---

    buildContextSummary(chatId: number): string {
        const ctx = this.ensure(chatId);
        const parts: string[] = [];

        const now = new Date().toLocaleString("en-US", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit", timeZoneName: "short",
        });
        parts.push(`[Current date/time: ${now}]`);

        if (ctx.flowState.status !== "idle") {
            parts.push(`[Flow state: ${ctx.flowState.status}]`);
        }
        if (ctx.lastAction) parts.push(`[Last action: ${ctx.lastAction}]`);
        if (ctx.lastPayment) {
            parts.push(`[Last payment: ${ctx.lastPayment.amount} ${ctx.lastPayment.token} to ${ctx.lastPayment.beneficiary}]`);
        }
        if (ctx.lastVendor) parts.push(`[Last vendor: ${ctx.lastVendor.name}]`);
        if (ctx.lastSchedule) parts.push(`[Last schedule: ${ctx.lastSchedule.amount} to ${ctx.lastSchedule.beneficiary}]`);
        if (ctx.lastInvoice) {
            parts.push(`[Last invoice: ${ctx.lastInvoice.vendor}, ${ctx.lastInvoice.amount} ${ctx.lastInvoice.currency}]`);
        }

        return parts.length > 0 ? "\n\nCurrent context:\n" + parts.join("\n") : "";
    }

    // --- Reset ---

    clearTemporaryContext(chatId: number): void {
        const ctx = this.ensure(chatId);
        ctx.flowState = { status: "idle" };
        ctx.lastAction = undefined;
    }

    reset(chatId: number): void {
        this.contexts.delete(chatId);
        if (this.db) {
            this.db.run("DELETE FROM conversations WHERE chat_id=$1", [chatId]).catch(() => {});
        }
    }

    // --- Trimming ---

    private trim(ctx: ChatContext): void {
        if (ctx.messages.length > MAX_MESSAGES) {
            const overflow = ctx.messages.splice(0, ctx.messages.length - SUMMARIZE_THRESHOLD);
            const summary = `[Earlier conversation: ${overflow.length} messages summarized]`;
            ctx.messages.unshift({ role: "system", content: summary });
        }
    }
}
