import { loadStore, saveStore } from "../storage/persistence";

const STORE_KEY = "episodic_memory.json";
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS_PER_USER = 3;
const MAX_EVENTS_PER_SESSION = 20;

export interface EpisodicSession {
    startedAt: number;
    lastActivityAt: number;
    events: string[];
    summary?: string; // set when session is closed
}

interface UserEpisodes {
    activeSession?: EpisodicSession;
    closedSessions: EpisodicSession[]; // newest first, max MAX_SESSIONS_PER_USER
}

type EpisodicStore = Record<string, UserEpisodes>;

export class EpisodicMemory {
    private store: EpisodicStore;

    constructor() {
        this.store = loadStore<EpisodicStore>(STORE_KEY);
    }

    /**
     * Record a user activity event (e.g. "paid 50 USDC to aws", "saved vendor jack").
     * Automatically creates or continues the active session.
     * If the previous session was idle >30min, closes it first.
     */
    record(chatId: number, event: string): void {
        const id = chatId.toString();
        const now = Date.now();

        if (!this.store[id]) {
            this.store[id] = { closedSessions: [] };
        }

        const user = this.store[id];

        // Check if active session has gone idle → close it
        if (user.activeSession && now - user.activeSession.lastActivityAt > SESSION_IDLE_MS) {
            this.closeSession(id, user);
        }

        // Start a new session if none active
        if (!user.activeSession) {
            user.activeSession = {
                startedAt: now,
                lastActivityAt: now,
                events: [],
            };
        }

        // Add event (cap to avoid unbounded growth)
        if (user.activeSession.events.length < MAX_EVENTS_PER_SESSION) {
            user.activeSession.events.push(event);
        }
        user.activeSession.lastActivityAt = now;

        this.persist();
    }

    /**
     * Get a compact context string for the LLM system prompt.
     * Includes the active session events + closed session summaries.
     */
    getContextString(chatId: number): string {
        const id = chatId.toString();
        const user = this.store[id];
        if (!user) return "";

        const now = Date.now();
        const parts: string[] = [];

        // Active session events (most relevant)
        if (user.activeSession && user.activeSession.events.length > 0) {
            // Check if session is still fresh (not idle)
            const isStale = now - user.activeSession.lastActivityAt > SESSION_IDLE_MS;
            if (!isStale) {
                const recent = user.activeSession.events.slice(-10);
                parts.push(`Current session: ${recent.join("; ")}`);
            }
        }

        // Past closed sessions (most recent first)
        for (const session of user.closedSessions.slice(0, 2)) {
            const summary = session.summary ?? this.buildSummary(session.events);
            const when = this.formatRelativeTime(session.lastActivityAt);
            parts.push(`Past session (${when}): ${summary}`);
        }

        return parts.length > 0 ? `[Episodic memory: ${parts.join(" | ")}]` : "";
    }

    /**
     * Explicitly close the active session for a user (e.g. on /reset).
     */
    closeActiveSession(chatId: number): void {
        const id = chatId.toString();
        const user = this.store[id];
        if (!user?.activeSession) return;
        this.closeSession(id, user);
        this.persist();
    }

    private closeSession(id: string, user: UserEpisodes): void {
        if (!user.activeSession) return;
        const session = user.activeSession;
        session.summary = this.buildSummary(session.events);
        user.closedSessions.unshift(session); // newest first
        user.closedSessions = user.closedSessions.slice(0, MAX_SESSIONS_PER_USER);
        user.activeSession = undefined;
    }

    private buildSummary(events: string[]): string {
        if (events.length === 0) return "no activity";
        if (events.length <= 3) return events.join("; ");
        // Summarize: first 2 + last 1 + count
        const head = events.slice(0, 2).join("; ");
        const tail = events[events.length - 1];
        const mid = events.length - 3;
        return mid > 0
            ? `${head}; (+${mid} more); ${tail}`
            : `${head}; ${tail}`;
    }

    private formatRelativeTime(ts: number): string {
        const diffMs = Date.now() - ts;
        const diffMin = Math.floor(diffMs / 60_000);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    }

    private persist(): void {
        saveStore(STORE_KEY, this.store);
    }
}
