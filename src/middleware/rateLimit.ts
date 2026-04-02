/**
 * Per-user sliding-window rate limiter.
 */
export class RateLimiter {
    private windows = new Map<number, number[]>();

    constructor(
        private maxRequests: number = 10,
        private windowMs: number = 10_000
    ) {}

    /**
     * Returns true if the request is allowed, false if rate-limited.
     */
    check(chatId: number): boolean {
        const now = Date.now();
        const cutoff = now - this.windowMs;

        let timestamps = this.windows.get(chatId);
        if (!timestamps) {
            timestamps = [];
            this.windows.set(chatId, timestamps);
        }

        // Remove expired entries
        while (timestamps.length > 0 && timestamps[0] < cutoff) {
            timestamps.shift();
        }

        if (timestamps.length >= this.maxRequests) {
            return false;
        }

        timestamps.push(now);
        return true;
    }
}
