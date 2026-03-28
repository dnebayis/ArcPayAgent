/**
 * Sliding-window rate limiter — per chatId.
 * Default: 10 requests per 10 seconds.
 */
export class RateLimiter {
    private windows: Map<number, number[]> = new Map();

    constructor(
        private readonly maxRequests: number = 10,
        private readonly windowMs: number = 10_000
    ) {}

    /**
     * Returns true if the request should be allowed, false if throttled.
     * Prunes expired timestamps on every call.
     */
    allow(chatId: number): boolean {
        const now = Date.now();
        const cutoff = now - this.windowMs;

        let timestamps = this.windows.get(chatId) ?? [];
        // Keep only timestamps within the current window
        timestamps = timestamps.filter(t => t > cutoff);
        timestamps.push(now);
        this.windows.set(chatId, timestamps);

        return timestamps.length <= this.maxRequests;
    }

    /** Remove stale entries to prevent unbounded memory growth. */
    prune(): void {
        const cutoff = Date.now() - this.windowMs;
        for (const [chatId, timestamps] of this.windows) {
            const trimmed = timestamps.filter(t => t > cutoff);
            if (trimmed.length === 0) {
                this.windows.delete(chatId);
            } else {
                this.windows.set(chatId, trimmed);
            }
        }
    }
}
