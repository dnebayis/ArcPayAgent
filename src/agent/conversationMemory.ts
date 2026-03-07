/**
 * Per-user conversation memory and context tracker.
 * Remembers recent messages, last actions, and pending context.
 */

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
    };
    /** Last payment that was prepared or sent */
    lastPayment?: {
        beneficiary: string;
        amount: string;
    };
    /** Last action the bot took */
    lastAction?: string;
    /** Recent conversation messages (max 20) */
    messages: { role: "user" | "assistant"; content: string }[];
}

const MAX_MESSAGES = 20;

export class ConversationMemory {
    private memory: Record<string, ConversationContext> = {};

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
        if (ctx.messages.length > MAX_MESSAGES) {
            ctx.messages = ctx.messages.slice(-MAX_MESSAGES);
        }
    }

    /** Add a bot response to history */
    addBotMessage(chatId: number, text: string): void {
        const ctx = this.ensure(chatId);
        ctx.messages.push({ role: "assistant", content: text });
        if (ctx.messages.length > MAX_MESSAGES) {
            ctx.messages = ctx.messages.slice(-MAX_MESSAGES);
        }
    }

    /** Store the last analyzed invoice */
    setLastInvoice(chatId: number, invoice: ConversationContext["lastInvoice"]): void {
        const ctx = this.ensure(chatId);
        ctx.lastInvoice = invoice;
        ctx.lastAction = "analyze_invoice";
    }

    /** Store the last payment prepared */
    setLastPayment(chatId: number, beneficiary: string, amount: string): void {
        const ctx = this.ensure(chatId);
        ctx.lastPayment = { beneficiary, amount };
        ctx.lastAction = "create_payment";
    }

    /** Set lastAction */
    setLastAction(chatId: number, action: string): void {
        this.ensure(chatId).lastAction = action;
    }

    /** Get full context for the user */
    getContext(chatId: number): ConversationContext {
        return this.ensure(chatId);
    }

    /** Get conversation history formatted for LLM */
    getHistory(chatId: number): { role: "user" | "assistant"; content: string }[] {
        return this.ensure(chatId).messages;
    }

    /** Build a context summary string for the LLM */
    buildContextSummary(chatId: number): string {
        const ctx = this.ensure(chatId);
        const parts: string[] = [];

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
            parts.push(`[Last analyzed invoice: vendor="${ctx.lastInvoice.vendor}", detected="${detected}", settlement="${settlement}", invoiceNumber="${ctx.lastInvoice.invoiceNumber}"]`);
        }
        if (ctx.lastPayment) {
            parts.push(`[Last payment: ${ctx.lastPayment.amount} USDC to ${ctx.lastPayment.beneficiary}]`);
        }
        if (ctx.lastAction) {
            parts.push(`[Last action: ${ctx.lastAction}]`);
        }

        return "\n\nCurrent context:\n" + parts.join("\n");
    }
}
