import type { ConversationMemory, FlowState } from "../memory/conversation";

/**
 * Thin wrapper for flow state access. Single source of truth.
 * Only the orchestrator should write to flow state.
 */
export class FlowStateManager {
    constructor(private memory: ConversationMemory) {}

    get(chatId: number): FlowState {
        return this.memory.getFlowState(chatId);
    }

    isAwaitingConfirmation(chatId: number): boolean {
        return this.get(chatId).status === "awaiting_confirmation";
    }

    isAwaitingAmount(chatId: number): boolean {
        return this.get(chatId).status === "awaiting_amount";
    }

    isIdle(chatId: number): boolean {
        return this.get(chatId).status === "idle";
    }

    clear(chatId: number): void {
        this.memory.clearFlowState(chatId);
    }
}
