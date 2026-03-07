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
        // Keep recipient resolution explicit.
        // Follow-up flows are handled in resolveSessionFollowUp / resolveFollowUp.
        // Avoid auto-filling the beneficiary from old session memory for inputs like "send 5".
    }

    if (resolved.action === "schedule_payment") {
        if (!resolved.beneficiary) {
            const session = sessionStore?.getSession(chatId);
            resolved.beneficiary = session?.lastVendor || resolved.beneficiary;
        }
    }

    return resolved;
}
