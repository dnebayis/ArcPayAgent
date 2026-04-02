/**
 * Optional allowlist guard. If ALLOWED_CHAT_IDS is set, only listed users can interact.
 */
export class AccessControl {
    private allowedIds: Set<number> | null;

    constructor(allowedChatIds?: string) {
        if (allowedChatIds?.trim()) {
            this.allowedIds = new Set(
                allowedChatIds.split(",").map(id => parseInt(id.trim(), 10)).filter(Number.isInteger)
            );
        } else {
            this.allowedIds = null; // Open to all
        }
    }

    isPermitted(chatId: number): boolean {
        if (!this.allowedIds) return true;
        return this.allowedIds.has(chatId);
    }
}
