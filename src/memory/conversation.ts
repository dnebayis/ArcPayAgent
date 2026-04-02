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

interface ChatContext {
    messages: ChatMessage[];
    flowState: FlowState;
    lastAction?: string;
    lastPayment?: { beneficiary: string; amount: string; token: string };
    lastVendor?: { name: string; address: string };
    lastSchedule?: { id: string; beneficiary: string; amount: number };
    lastInvoice?: { vendor: string; amount: string; currency: string; invoiceNumber?: string };
}

const MAX_MESSAGES = 100;
const SUMMARIZE_THRESHOLD = 30;

export class ConversationMemory {
    private contexts = new Map<number, ChatContext>();

    private ensure(chatId: number): ChatContext {
        if (!this.contexts.has(chatId)) {
            this.contexts.set(chatId, {
                messages: [],
                flowState: { status: "idle" },
            });
        }
        return this.contexts.get(chatId)!;
    }

    addUserMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "user", content: text });
        this.trim(ctx);
    }

    addBotMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "assistant", content: text });
        this.trim(ctx);
    }

    getHistory(chatId: number): ChatMessage[] {
        return this.ensure(chatId).messages.slice(-MAX_MESSAGES);
    }

    // --- Flow state ---

    getFlowState(chatId: number): FlowState {
        return this.ensure(chatId).flowState;
    }

    setFlowState(chatId: number, state: FlowState): void {
        this.ensure(chatId).flowState = state;
    }

    clearFlowState(chatId: number): void {
        this.ensure(chatId).flowState = { status: "idle" };
    }

    // --- Context setters (no side-effects on flowState) ---

    setLastAction(chatId: number, action: string): void {
        this.ensure(chatId).lastAction = action;
    }

    setLastPayment(chatId: number, beneficiary: string, amount: string, token: string): void {
        this.ensure(chatId).lastPayment = { beneficiary, amount, token };
    }

    setLastVendor(chatId: number, name: string, address: string): void {
        this.ensure(chatId).lastVendor = { name, address };
    }

    setLastSchedule(chatId: number, id: string, beneficiary: string, amount: number): void {
        this.ensure(chatId).lastSchedule = { id, beneficiary, amount };
    }

    setLastInvoice(chatId: number, vendor: string, amount: string, currency: string, invoiceNumber?: string): void {
        this.ensure(chatId).lastInvoice = { vendor, amount, currency, invoiceNumber };
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

    // --- Clear ---

    clearTemporaryContext(chatId: number): void {
        const ctx = this.ensure(chatId);
        ctx.flowState = { status: "idle" };
        ctx.lastAction = undefined;
    }

    reset(chatId: number): void {
        this.contexts.delete(chatId);
    }

    // --- Trimming ---

    private trim(ctx: ChatContext): void {
        if (ctx.messages.length > MAX_MESSAGES) {
            // Keep last MAX_MESSAGES, summarize overflow
            const overflow = ctx.messages.splice(0, ctx.messages.length - SUMMARIZE_THRESHOLD);
            const summary = `[Earlier conversation: ${overflow.length} messages summarized]`;
            ctx.messages.unshift({ role: "system", content: summary });
        }
    }
}
