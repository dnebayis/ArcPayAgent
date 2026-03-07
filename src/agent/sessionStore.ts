export interface SessionState {
    chatId: number;
    recentMessages: { role: string; content: string }[];
    lastIntent?: string;
    pendingAction?: string;
    pendingIntent?: {
        action: string;
        amount?: number;
        beneficiary?: string;
        schedule_time?: string;
    };
    lastVendor?: string;
    lastAmount?: number;
    pendingPayment?: {
        vendor: string | null;
        amount: number;
    };
}

export class SessionStore {
    private sessions: Record<string, SessionState> = {};
    private maxMessages: number;

    constructor(maxMessages: number = 10) {
        this.maxMessages = maxMessages;
    }

    private ensure(chatId: number): SessionState {
        const id = chatId.toString();
        if (!this.sessions[id]) {
            this.sessions[id] = {
                chatId,
                recentMessages: []
            };
        }
        return this.sessions[id];
    }

    getSession(chatId: number): SessionState {
        return this.ensure(chatId);
    }

    addMessage(chatId: number, role: 'user' | 'assistant', content: string) {
        const session = this.ensure(chatId);
        session.recentMessages.push({ role, content });
        if (session.recentMessages.length > this.maxMessages) {
            session.recentMessages = session.recentMessages.slice(-this.maxMessages);
        }
    }

    setPendingPayment(chatId: number, vendor: string | null, amount: number) {
        const session = this.ensure(chatId);
        session.pendingPayment = { vendor, amount };
        session.lastVendor = vendor || session.lastVendor;
        session.lastAmount = amount;
        session.pendingAction = 'confirm_payment';
        delete session.pendingIntent;
    }

    updatePendingPayment(chatId: number, updates: { vendor?: string | null, amount?: number }) {
        const session = this.ensure(chatId);
        if (session.pendingPayment) {
            if (updates.vendor !== undefined) session.pendingPayment.vendor = updates.vendor;
            if (updates.amount !== undefined) session.pendingPayment.amount = updates.amount;
            session.lastVendor = session.pendingPayment.vendor || session.lastVendor;
            session.lastAmount = session.pendingPayment.amount;
        }
    }

    clearPendingState(chatId: number) {
        const session = this.ensure(chatId);
        delete session.pendingAction;
        delete session.pendingPayment;
        delete session.pendingIntent;
    }

    setPendingIntent(chatId: number, intent: { action: string; amount?: number; beneficiary?: string; schedule_time?: string }) {
        const session = this.ensure(chatId);
        session.pendingIntent = { ...intent };
        session.pendingAction = "collect_intent_details";
        if (intent.beneficiary) {
            session.lastVendor = intent.beneficiary;
        }
        if (intent.amount !== undefined) {
            session.lastAmount = intent.amount;
        }
    }

    clearPendingIntent(chatId: number) {
        const session = this.ensure(chatId);
        delete session.pendingIntent;
        if (session.pendingAction === "collect_intent_details") {
            delete session.pendingAction;
        }
    }

    setLastIntent(chatId: number, intentAction: string) {
        const session = this.ensure(chatId);
        session.lastIntent = intentAction;
    }
}
