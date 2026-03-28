import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator";

// Access private static patterns directly for unit-level pattern testing.
// TypeScript enforces private at compile time only; the patterns exist on the class at runtime.
const P = Orchestrator as unknown as {
    CONFIRM_PATTERN: RegExp;
    CANCEL_PATTERN: RegExp;
    PAYMENT_MODIFY_PATTERN: RegExp;
    CAPABILITY_PATTERN: RegExp;
};

// ─── Minimal mock factory ───────────────────────────────────────────────────

function makeOrchestrator(lastAction?: string) {
    const bot = {
        sendMessage: vi.fn().mockResolvedValue({}),
        sendChatAction: vi.fn().mockResolvedValue({}),
    };
    const llmKeyStore = {
        // Returning null simulates no LLM key — execution stops after the capability
        // guard (or pending-payment guards) without ever reaching the LLM call.
        getKey: vi.fn().mockReturnValue(null),
    };
    const memory = {
        addUserMessage: vi.fn(),
        addBotMessage: vi.fn(),
        getContext: vi.fn().mockReturnValue({ lastAction: lastAction ?? null }),
        buildContextSummary: vi.fn().mockReturnValue(""),
        getHistory: vi.fn().mockReturnValue([]),
        setLastAction: vi.fn(),
    };
    const walletStore = { getWalletAddress: vi.fn().mockReturnValue(null) };
    const researchTools = {
        isResearchAction: vi.fn().mockReturnValue(false),
        fetch: vi.fn(),
    };
    const dispatchFn = vi.fn().mockResolvedValue(undefined);

    const orc = new Orchestrator(
        bot as any,
        llmKeyStore as any,
        memory as any,
        walletStore as any,
        researchTools as any,
        dispatchFn
    );
    return { orc, bot, llmKeyStore, memory, dispatchFn };
}

// ─── CONFIRM_PATTERN ────────────────────────────────────────────────────────

describe("CONFIRM_PATTERN", () => {
    const matches = [
        "yes", "YES", "Yes",
        "evet", "Evet",
        "confirm", "Confirm",
        "ok", "OK", "Ok",
        "go", "GO",
        "go ahead",
        "yes go",
        "proceed",
        "let's do it",
        "do it",
        "tamam", "Tamam",
        "devam",
        "onayla",
        "yap",
        "yap bunu",
        "onaylıyorum",
        "tamamdır",
        "kabul",
        "sure",
        "alright",
        "yep",
        "send it",
        "gönder",
        "gönder bunu",
    ];

    const nonMatches = [
        "yes please",
        "can you confirm?",
        "not sure",
        "ok wait",
        "maybe",
        "cancel",
        "hello",
        "send 5 usdc to jack",
        "",
    ];

    it.each(matches)('matches "%s"', (phrase) => {
        expect(P.CONFIRM_PATTERN.test(phrase)).toBe(true);
    });

    it.each(nonMatches)('does not match "%s"', (phrase) => {
        expect(P.CONFIRM_PATTERN.test(phrase)).toBe(false);
    });
});

// ─── CANCEL_PATTERN ─────────────────────────────────────────────────────────

describe("CANCEL_PATTERN", () => {
    const matches = [
        "cancel", "CANCEL", "Cancel",
        "iptal",
        "iptal et",
        "vazgeç",
        "hayır",
        "no", "NO",
        "dur",
        "stop", "STOP",
        "leave it",
    ];

    const nonMatches = [
        "cancel schedule",
        "I want to cancel this",
        "please cancel",
        "no problem",
        "not now",
        "yes",
        "",
    ];

    it.each(matches)('matches "%s"', (phrase) => {
        expect(P.CANCEL_PATTERN.test(phrase)).toBe(true);
    });

    it.each(nonMatches)('does not match "%s"', (phrase) => {
        expect(P.CANCEL_PATTERN.test(phrase)).toBe(false);
    });
});

// ─── PAYMENT_MODIFY_PATTERN ─────────────────────────────────────────────────

describe("PAYMENT_MODIFY_PATTERN", () => {
    const matches = [
        "not 1 eurc send 10 eurc",   // matches via the numeric part (1 eurc)
        "actually send 100 usdc",    // matches via numeric + token
        "change to 200 usdc",        // matches via numeric + token
        "change it to 50 eurc",      // matches via numeric + token
        "make it 75 usdc",           // matches via numeric + token
        "send 50 usdc",              // explicit send + amount + token
        "send 10 eurc",
        "pay 100 usdc",              // explicit pay + amount + token
        "100 usdc",
        "5.5 eurc",
    ];

    const nonMatches = [
        "yes",
        "cancel",
        "hello",
        "show my balance",
        "list vendors",
        "what can you do?",
        // Words that were previously over-matched:
        "not sure",
        "I'm not sure how much",
        "I need to make a payment to aws but I'm not sure how much, can you help?",
        "actually, what's the BTC price?",
        "instead of that, show my wallet",
        "change my mind",
    ];

    it.each(matches)('matches "%s"', (phrase) => {
        expect(P.PAYMENT_MODIFY_PATTERN.test(phrase)).toBe(true);
    });

    it.each(nonMatches)('does not match "%s"', (phrase) => {
        expect(P.PAYMENT_MODIFY_PATTERN.test(phrase)).toBe(false);
    });
});

// ─── CAPABILITY_PATTERN ─────────────────────────────────────────────────────

describe("CAPABILITY_PATTERN", () => {
    const matches = [
        "what can you do",
        "what can you do?",
        "What can you do?",
        "what do you do",
        "what are you",
        "what are you?",
        "list your features",
        "list your capabilities",
        "show your features",
        "show your capabilities",
        "give me a list of what you can do",
        "create a detailed list of what you can do",
        "create a detailed list",
        "detailed list",
        "your capabilities",
        "your features",
        "your functions",
        "your abilities",
        "Now I'm going to ask you to create a detailed list of what you can do.",
        "can you create detailed list?",
        "show me what you can do",
    ];

    const nonMatches = [
        "cancel",
        "yes",
        "send 5 usdc to jack",
        "what's my balance",
        "show my wallet",
        "hello",
        "is Arc up?",
        "what is bitcoin?",
    ];

    it.each(matches)('matches "%s"', (phrase) => {
        expect(P.CAPABILITY_PATTERN.test(phrase)).toBe(true);
    });

    it.each(nonMatches)('does not match "%s"', (phrase) => {
        expect(P.CAPABILITY_PATTERN.test(phrase)).toBe(false);
    });
});

// ─── Behavioral guard tests ─────────────────────────────────────────────────

describe("Pending payment — confirm guard", () => {
    it("intercepts confirmation and directs to button — does not dispatch", async () => {
        const { orc, bot, dispatchFn } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "yes");
        expect(bot.sendMessage).toHaveBeenCalledOnce();
        const [, msgText] = bot.sendMessage.mock.calls[0];
        expect(msgText).toContain("**Confirm**");
        expect(dispatchFn).not.toHaveBeenCalled();
    });

    it("is case-insensitive for confirmation", async () => {
        const { orc, bot } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "YES");
        expect(bot.sendMessage).toHaveBeenCalledOnce();
        expect(bot.sendMessage.mock.calls[0][1]).toContain("**Confirm**");
    });

    it("intercepts tamam (Turkish)", async () => {
        const { orc, bot } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "tamam");
        expect(bot.sendMessage.mock.calls[0][1]).toContain("**Confirm**");
    });
});

describe("Pending payment — cancel guard", () => {
    it("intercepts cancel and directs to button — does not dispatch", async () => {
        const { orc, bot, dispatchFn } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "cancel");
        expect(bot.sendMessage).toHaveBeenCalledOnce();
        const [, msgText] = bot.sendMessage.mock.calls[0];
        expect(msgText).toContain("**Cancel**");
        expect(dispatchFn).not.toHaveBeenCalled();
    });

    it("intercepts hayır (Turkish)", async () => {
        const { orc, bot } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "hayır");
        expect(bot.sendMessage.mock.calls[0][1]).toContain("**Cancel**");
    });

    it("intercepts no", async () => {
        const { orc, bot } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "no");
        expect(bot.sendMessage.mock.calls[0][1]).toContain("**Cancel**");
    });
});

describe("Pending payment — modification guard", () => {
    it("blocks amount correction while payment is pending", async () => {
        const { orc, bot, dispatchFn } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "not 1 eurc send 10 eurc");
        expect(bot.sendMessage).toHaveBeenCalledOnce();
        const [, msgText] = bot.sendMessage.mock.calls[0];
        expect(msgText).toMatch(/cancel.*first/i);
        expect(dispatchFn).not.toHaveBeenCalled();
    });

    it("blocks 'actually make it X' while payment is pending", async () => {
        const { orc, bot } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "actually make it 50 usdc");
        expect(bot.sendMessage.mock.calls[0][1]).toMatch(/cancel.*first/i);
    });

    it("blocks 'change to X usdc' while payment is pending", async () => {
        const { orc, bot } = makeOrchestrator("create_payment");
        await orc.handleMessage(1, "change to 100 usdc");
        expect(bot.sendMessage.mock.calls[0][1]).toMatch(/cancel.*first/i);
    });

    it("does NOT block modification when no payment is pending", async () => {
        // lastAction is not create_payment — guard should not fire
        const { orc, bot } = makeOrchestrator(undefined);
        await orc.handleMessage(1, "send 50 usdc to jack");
        // Will hit "no LLM key" path, not modification guard
        const msgText: string = bot.sendMessage.mock.calls[0]?.[1] ?? "";
        expect(msgText).not.toMatch(/cancel.*first/i);
    });
});

describe("Capability query guard", () => {
    it("returns capability list without reaching LLM", async () => {
        const { orc, bot, llmKeyStore, dispatchFn } = makeOrchestrator();
        await orc.handleMessage(1, "what can you do?");
        // capability guard fires before LLM key check
        expect(llmKeyStore.getKey).not.toHaveBeenCalled();
        expect(dispatchFn).not.toHaveBeenCalled();
        const [, msgText] = bot.sendMessage.mock.calls[0];
        expect(msgText).toMatch(/USDC/);
        expect(msgText).toMatch(/EURC/);
    });

    it("handles long phrasing: 'create a detailed list of what you can do'", async () => {
        const { orc, bot } = makeOrchestrator();
        await orc.handleMessage(1, "Now I'm going to ask you to create a detailed list of what you can do.");
        expect(bot.sendMessage.mock.calls[0][1]).toMatch(/USDC/);
    });

    it("handles 'can you create detailed list?'", async () => {
        const { orc, bot } = makeOrchestrator();
        await orc.handleMessage(1, "can you create detailed list?");
        expect(bot.sendMessage.mock.calls[0][1]).toMatch(/USDC/);
    });

    it("handles 'your capabilities'", async () => {
        const { orc, bot } = makeOrchestrator();
        await orc.handleMessage(1, "your capabilities");
        expect(bot.sendMessage.mock.calls[0][1]).toMatch(/USDC/);
    });

    it("does not fire for normal messages", async () => {
        const { orc } = makeOrchestrator();
        // "show wallet" should not trigger capability guard
        // It will fall through to LLM key check (returns null = "set your LLM key" message)
        await orc.handleMessage(1, "show my wallet");
        // Just verify no throw — behavior depends on LLM key mock returning null
    });
});
