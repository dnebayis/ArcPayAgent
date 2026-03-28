/**
 * Optional chat-ID allowlist.
 * When ALLOWED_CHAT_IDS env var is empty the bot is open to all users.
 */
export class AccessControl {
    private readonly allowed: Set<number> | null;

    constructor(allowedChatIds: string | undefined) {
        if (!allowedChatIds?.trim()) {
            this.allowed = null; // open — allow all
        } else {
            const ids = allowedChatIds
                .split(",")
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n));
            this.allowed = new Set(ids);
        }
    }

    isAllowed(chatId: number): boolean {
        if (this.allowed === null) return true;
        return this.allowed.has(chatId);
    }

    get isRestricted(): boolean {
        return this.allowed !== null;
    }
}
