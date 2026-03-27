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
    /** User's language code from Telegram (e.g. "tr", "en", "de") */
    language?: string;
    /** Recent conversation messages (max 20) */
    messages: { role: "user" | "assistant"; content: string }[];
    /** Recent completed activities (max 20) */
    activities?: { action: string; summary: string; timestamp: number }[];
}

const MAX_MESSAGES = 20;
const MAX_ACTIVITIES = 20;

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

    clearLastInvoice(chatId: number): void {
        const ctx = this.ensure(chatId);
        delete ctx.lastInvoice;
    }

    /** Store the last payment prepared */
    setLastPayment(chatId: number, beneficiary: string, amount: string, token?: "USDC" | "EURC"): void {
        const ctx = this.ensure(chatId);
        ctx.lastPayment = { beneficiary, amount, token };
        ctx.lastAction = "create_payment";
    }

    /** Store the last schedule prepared */
    setLastSchedule(chatId: number, beneficiary: string, amount: string, scheduledFor?: number, id?: string): void {
        const ctx = this.ensure(chatId);
        ctx.lastSchedule = { id, beneficiary, amount, scheduledFor };
        ctx.lastAction = "schedule_payment";
    }

    setLanguage(chatId: number, lang: string): void {
        if (!lang) return;
        this.ensure(chatId).language = lang;
    }

    setLastVendor(chatId: number, name: string, address?: string): void {
        const ctx = this.ensure(chatId);
        ctx.lastVendor = { name, address };
        ctx.lastAction = "vendor_detail";
    }

    clearLastVendor(chatId: number): void {
        const ctx = this.ensure(chatId);
        delete ctx.lastVendor;
    }

    /** Set lastAction */
    setLastAction(chatId: number, action: string): void {
        this.ensure(chatId).lastAction = action;
    }

    /** Record a completed product action for later conversational recall */
    recordAction(chatId: number, action: string, summary: string): void {
        const ctx = this.ensure(chatId);
        if (!ctx.activities) {
            ctx.activities = [];
        }
        ctx.activities.push({ action, summary, timestamp: Date.now() });
        if (ctx.activities.length > MAX_ACTIVITIES) {
            ctx.activities = ctx.activities.slice(-MAX_ACTIVITIES);
        }
        ctx.lastAction = action;
    }

    /** Get full context for the user */
    getContext(chatId: number): ConversationContext {
        return this.ensure(chatId);
    }

    clearContext(chatId: number): void {
        const id = chatId.toString();
        delete this.memory[id];
    }

    /** Get conversation history formatted for LLM */
    getHistory(chatId: number): { role: "user" | "assistant"; content: string }[] {
        return this.ensure(chatId).messages;
    }

    getRecentActivities(chatId: number): { action: string; summary: string; timestamp: number }[] {
        return this.ensure(chatId).activities || [];
    }

    getLastActivity(chatId: number): { action: string; summary: string; timestamp: number } | null {
        const activities = this.getRecentActivities(chatId);
        return activities.length ? activities[activities.length - 1] : null;
    }

    summarizeToday(chatId: number): string | null {
        const activities = this.getRecentActivities(chatId);
        if (!activities.length) return null;

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const today = activities.filter((activity) => activity.timestamp >= startOfDay);

        if (!today.length) return null;

        const uniqueSummaries: string[] = [];
        for (const activity of today) {
            if (!uniqueSummaries.includes(activity.summary)) {
                uniqueSummaries.push(activity.summary);
            }
        }

        const top = uniqueSummaries.slice(0, 4);
        const summary = top.map((item) => `• ${item}`).join("\n");
        return `Today we worked on:\n${summary}`;
    }

    describeLastInvoice(chatId: number): string | null {
        const invoice = this.ensure(chatId).lastInvoice;
        if (!invoice) return null;

        const amount = invoice.detectedAmount || invoice.amount;
        const currency = invoice.detectedCurrency || invoice.currency || "USD";
        const vendor = invoice.vendor || "Unknown vendor";

        let message = `The last invoice I analyzed was from ${vendor}`;
        if (amount) {
            message += ` for ${amount} ${currency}`;
        }
        if (invoice.invoiceNumber) {
            message += ` (invoice #${invoice.invoiceNumber})`;
        }
        return `${message}.`;
    }

    describeLastPayment(chatId: number): string | null {
        const payment = this.ensure(chatId).lastPayment;
        if (!payment) return null;
        const token = payment.token ?? "USDC";
        return `The last payment I prepared was ${payment.amount} ${token} to ${payment.beneficiary}.`;
    }

    describeLastPaymentAmount(chatId: number): string | null {
        const payment = this.ensure(chatId).lastPayment;
        if (!payment) return null;
        const token = payment.token ?? "USDC";
        return `The last payment amount was ${payment.amount} ${token}.`;
    }

    describeLastInvoiceAmount(chatId: number): string | null {
        const invoice = this.ensure(chatId).lastInvoice;
        if (!invoice) return null;
        const amount = invoice.detectedAmount || invoice.amount;
        const currency = invoice.detectedCurrency || invoice.currency || "USD";
        if (!amount) return null;
        return `The last invoice amount was ${amount} ${currency}.`;
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
        if (ctx.activities?.length) {
            const recent = ctx.activities
                .slice(-5)
                .map((activity) => `${activity.action}: ${activity.summary}`);
            parts.push(`[Recent completed actions: ${recent.join(" | ")}]`);
        }

        return "\n\nCurrent context:\n" + parts.join("\n");
    }
}
