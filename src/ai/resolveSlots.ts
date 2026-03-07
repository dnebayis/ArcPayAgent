import { ConversationMemory } from "../agent/conversationMemory";
import { SessionStore } from "../agent/sessionStore";
import { MemoryStore } from "./memoryStore";

export interface SlotResolutionInput {
    chatId: number;
    intent: {
        action: string;
        amount?: number;
        beneficiary?: string;
        schedule_time?: string;
    };
    conversationMemory?: ConversationMemory;
    sessionStore?: SessionStore;
    memoryStore?: MemoryStore;
}

export function resolveSlots(input: SlotResolutionInput): SlotResolutionInput["intent"] {
    const { chatId, conversationMemory, sessionStore, memoryStore } = input;
    const resolved = { ...input.intent };

    if (resolved.action === "create_payment") {
        if (!resolved.beneficiary) {
            const session = sessionStore?.getSession(chatId);
            const ctx = conversationMemory?.getContext(chatId);
            resolved.beneficiary =
                session?.pendingPayment?.vendor ||
                session?.lastVendor ||
                ctx?.lastPayment?.beneficiary ||
                resolved.beneficiary;
        }

        if ((resolved.amount === undefined || resolved.amount === null) && resolved.beneficiary && memoryStore) {
            const avg = memoryStore.getAveragePayment(chatId, resolved.beneficiary);
            if (avg !== null) {
                resolved.amount = parseFloat(avg.toFixed(2));
            }
        }
    }

    if (resolved.action === "schedule_payment") {
        if (!resolved.beneficiary) {
            const session = sessionStore?.getSession(chatId);
            resolved.beneficiary = session?.lastVendor || resolved.beneficiary;
        }
    }

    return resolved;
}
