import { describe, it, expect } from "vitest";
import { IntentParser } from "../../src/ai/intentParser";
import { ToolRegistry } from "../../src/agent/toolRegistry";
import { ToolRouter } from "../../src/agent/toolRouter";
import { SessionStore } from "../../src/agent/sessionStore";
import { MemoryStore } from "../../src/ai/memoryStore";
import { vi } from "vitest";

describe("IntentParser — Regex Layer", () => {
    const parser = new IntentParser();

    it("should parse 'send 1 usdc jack'", async () => {
        const intent = await parser.parse(1, "send 1 usdc jack");
        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(1);
        expect(intent.beneficiary).toBe("jack");
    });

    it("should parse 'send 5 usdc to 0xabc'", async () => {
        const intent = await parser.parse(1, "send 5 usdc to 0x00000000000000000000000000000000000000ab");
        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(5);
        expect(intent.beneficiary).toBe("0x00000000000000000000000000000000000000ab");
    });

    it("should parse '0xabc send 3 usdc'", async () => {
        const intent = await parser.parse(1, "0x00000000000000000000000000000000000000ab send 3 usdc");
        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(3);
        expect(intent.beneficiary).toBe("0x00000000000000000000000000000000000000ab");
    });

    it("should parse 'pay 10 usdc to jack'", async () => {
        const intent = await parser.parse(1, "pay 10 usdc to jack");
        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(10);
        expect(intent.beneficiary).toBe("jack");
    });

    it("should parse decimal amounts", async () => {
        const intent = await parser.parse(1, "send 2.5 usdc to alice");
        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(2.5);
    });

    it("should parse 'save vendor aws 0x...'", async () => {
        const intent = await parser.parse(1, "save vendor aws 0x0000000000000000000000000000000000000001");
        expect(intent.action).toBe("save_vendor");
        expect(intent.name).toBe("aws");
        expect(intent.address).toBe("0x0000000000000000000000000000000000000001");
    });

    it("should parse 'create payment request 20 usdc'", async () => {
        const intent = await parser.parse(1, "create payment request 20 usdc");
        expect(intent.action).toBe("create_payment_request");
        expect(intent.amount).toBe(20);
    });

    it("should parse 'request 5 usdc'", async () => {
        const intent = await parser.parse(1, "request 5 usdc");
        expect(intent.action).toBe("create_payment_request");
        expect(intent.amount).toBe(5);
    });
});

describe("IntentParser — Heuristic Layer", () => {
    const parser = new IntentParser();

    it("should detect 'list vendors'", async () => {
        expect((await parser.parse(1, "list vendors")).action).toBe("list_vendors");
    });

    it("should detect 'show vendors'", async () => {
        expect((await parser.parse(1, "show vendors")).action).toBe("list_vendors");
    });

    it("should detect 'analyze this invoice'", async () => {
        expect((await parser.parse(1, "analyze this invoice")).action).toBe("analyze_invoice");
    });

    it("should detect 'how much did I spend this month'", async () => {
        expect((await parser.parse(1, "how much did I spend this month")).action).toBe("report");
    });

    it("should detect 'status'", async () => {
        expect((await parser.parse(1, "status")).action).toBe("status");
    });

    it("should detect 'export wallet'", async () => {
        expect((await parser.parse(1, "export wallet")).action).toBe("export_wallet");
    });

    it("should detect 'create wallet'", async () => {
        expect((await parser.parse(1, "create wallet")).action).toBe("create_wallet");
    });

    it("should detect 'can you analyze pdf'", async () => {
        expect((await parser.parse(1, "can you analyze pdf")).action).toBe("analyze_invoice");
    });

    it("should detect 'show my address'", async () => {
        expect((await parser.parse(1, "show my address")).action).toBe("show_wallet");
    });

    it("should detect greetings like 'hello'", async () => {
        expect((await parser.parse(1, "hello")).action).toBe("greeting");
    });

    it("should detect 'what can you do'", async () => {
        expect((await parser.parse(1, "what can you do")).action).toBe("greeting");
    });

    it("should detect 'thanks'", async () => {
        expect((await parser.parse(1, "thanks")).action).toBe("acknowledgment");
    });

    it("should detect 'vendors'", async () => {
        expect((await parser.parse(1, "vendors")).action).toBe("list_vendors");
    });

    it("should detect 'i need a wallet'", async () => {
        expect((await parser.parse(1, "i need a wallet")).action).toBe("create_wallet");
    });

    it("should detect 'check balance'", async () => {
        expect((await parser.parse(1, "check balance")).action).toBe("wallet_intelligence");
    });
});

describe("IntentParser — Smart Fallback", () => {
    const parser = new IntentParser();

    it("should give payment-related guidance when user mentions 'send'", async () => {
        const intent = await parser.parse(1, "i want to send money");
        expect(intent.action).toBe("unknown");
        expect(intent.message).toContain("send");
    });

    it("should give vendor guidance when user mentions 'vendor'", async () => {
        const intent = await parser.parse(1, "how do i save a vendor");
        expect(intent.action).toBe("unknown");
        expect(intent.message).toContain("vendor");
    });

    it("should give invoice guidance when user mentions 'pdf'", async () => {
        const intent = await parser.parse(1, "i have a pdf");
        expect(intent.action).toBe("unknown");
        expect(intent.message).toContain("invoice");
    });

    it("should give generic help for truly unrecognized input", async () => {
        const intent = await parser.parse(1, "abcdefgh12345");
        expect(intent.action).toBe("unknown");
        expect(intent.message).toContain("/help");
    });

    it("should detect 'show my wallet status' as wallet_intelligence", async () => {
        const intent = await parser.parse(1, "show my wallet status");
        expect(intent.action).toBe("wallet_intelligence");
    });

    it("should detect 'circle wallet balance' as wallet_intelligence", async () => {
        const intent = await parser.parse(1, "circle wallet balance");
        expect(intent.action).toBe("wallet_intelligence");
    });
});

describe("IntentParser — Session Context", () => {
    it("should resolve 'yes' to confirm payment from session", async () => {
        const sessionStore = new SessionStore();
        const parser = new IntentParser(undefined, undefined, sessionStore);

        sessionStore.setPendingPayment(1, "jack", 5);

        const intent = await parser.parse(1, "yes");
        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(5);
        expect(intent.beneficiary).toBe("jack");
    });

    it("should resolve amount modification via follow-up message", async () => {
        const sessionStore = new SessionStore();
        const parser = new IntentParser(undefined, undefined, sessionStore);

        sessionStore.setPendingPayment(1, "jack", 5);

        const intent = await parser.parse(1, "actually make it 3");
        expect(intent.action).toBe("update_payment_amount");
        expect(intent.amount).toBe(3);
        expect(intent.beneficiary).toBe("jack");

        // Verify session was updated
        expect(sessionStore.getSession(1).pendingPayment?.amount).toBe(3);
    });

    it("should resolve vendor modification via follow-up message", async () => {
        const sessionStore = new SessionStore();
        const parser = new IntentParser(undefined, undefined, sessionStore);

        sessionStore.setPendingPayment(1, "jack", 5);

        const intent = await parser.parse(1, "change to alice");
        expect(intent.action).toBe("update_payment_vendor");
        expect(intent.amount).toBe(5);
        expect(intent.beneficiary).toBe("alice");
    });

    it("should handle multi-step payment conversation", async () => {
        const sessionStore = new SessionStore();
        const parser = new IntentParser(undefined, undefined, sessionStore);

        // Step 1: User says pay someone
        sessionStore.setPendingPayment(1, "jack", 5);

        // Step 2: User modifies amount
        const updateAmountIntent = await parser.parse(1, "make it 10");
        expect(updateAmountIntent.action).toBe("update_payment_amount");
        expect(updateAmountIntent.amount).toBe(10);

        // Step 3: User confirms
        const confirmIntent = await parser.parse(1, "do it");
        expect(confirmIntent.action).toBe("create_payment");
        expect(confirmIntent.amount).toBe(10);
        expect(confirmIntent.beneficiary).toBe("jack");
    });

    it("should resolve memo modification via follow-up message", async () => {
        const sessionStore = new SessionStore();
        const parser = new IntentParser(undefined, undefined, sessionStore);

        sessionStore.setPendingPayment(1, "jack", 5);

        const intent = await parser.parse(1, "add memo coffee");
        expect(intent.action).toBe("update_payment_memo");
        expect(intent.message).toBe("coffee");
    });

    it("should handle cancel flow via NLP", async () => {
        const sessionStore = new SessionStore();
        const parser = new IntentParser(undefined, undefined, sessionStore);

        sessionStore.setPendingPayment(1, "jack", 5);

        const intent = await parser.parse(1, "cancel that payment");
        expect(intent.action).toBe("cancel_payment");
    });
});

describe("IntentParser — Advanced NLP Memory Context", () => {
    it("should resolve 'send jack the usual amount'", async () => {
        const memoryStore = new MemoryStore("/dev/null/false.json"); // Provide dummy path
        // mock memoryStore
        vi.spyOn(memoryStore, "getAveragePayment").mockReturnValue(25.5);

        const parser = new IntentParser(undefined, undefined, undefined, memoryStore);
        const intent = await parser.parse(1, "send jack the usual amount");

        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(25.5);
        expect(intent.beneficiary).toBe("jack");
    });

    it("should resolve 'pay the last invoice'", async () => {
        const memoryStore = new MemoryStore("/dev/null/false.json");
        vi.spyOn(memoryStore, "getLastInvoice").mockReturnValue({ vendor: "aws", amount: 15.0, timestamp: 123 });

        const parser = new IntentParser(undefined, undefined, undefined, memoryStore);
        const intent = await parser.parse(1, "pay the last invoice");

        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(15);
        expect(intent.beneficiary).toBe("aws");
    });

    it("should resolve 'pay that aws invoice'", async () => {
        const memoryStore = new MemoryStore("/dev/null/false.json");
        vi.spyOn(memoryStore, "getRecentInvoiceByVendor").mockReturnValue({ vendor: "aws", amount: 45.0, timestamp: 123 });

        const parser = new IntentParser(undefined, undefined, undefined, memoryStore);
        const intent = await parser.parse(1, "pay that aws invoice");

        expect(intent.action).toBe("create_payment");
        expect(intent.amount).toBe(45);
        expect(intent.beneficiary).toBe("aws");
    });
});

describe("ToolRegistry", () => {
    it("should register and retrieve tools", () => {
        const registry = new ToolRegistry();
        registry.register("create_payment", "Send USDC", vi.fn());

        expect(registry.has("create_payment")).toBe(true);
        expect(registry.has("nonexistent")).toBe(false);
    });

    it("should list all registered actions", () => {
        const registry = new ToolRegistry();
        registry.register("create_payment", "Send USDC", vi.fn());
        registry.register("save_vendor", "Save vendor", vi.fn());

        const actions = registry.listActions();
        expect(actions).toContain("create_payment");
        expect(actions).toContain("save_vendor");
    });

    it("should list full tool details", () => {
        const registry = new ToolRegistry();
        registry.register("report", "Spending report", vi.fn());

        const tools = registry.listTools();
        expect(tools.length).toBe(1);
        expect(tools[0].action).toBe("report");
        expect(tools[0].description).toBe("Spending report");
    });
});

describe("ToolRouter", () => {
    it("should route intent to correct handler", async () => {
        const handler = vi.fn();
        const registry = new ToolRegistry();
        registry.register("create_payment", "Send USDC", handler);

        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        const result = await router.routeIntent(12345, {
            action: "create_payment", amount: 5, beneficiary: "jack"
        });

        expect(result).toBe(true);
        expect(handler).toHaveBeenCalledWith(12345, expect.objectContaining({
            action: "create_payment", amount: 5, beneficiary: "jack"
        }));
    });

    it("should send fallback for unknown actions", async () => {
        const registry = new ToolRegistry();
        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        const result = await router.routeIntent(12345, { action: "unknown" });

        expect(result).toBe(false);
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("wallets, payments"));
    });

    it("should use custom fallback message when provided", async () => {
        const registry = new ToolRegistry();
        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        await router.routeIntent(12345, { action: "unknown", message: "Custom help text" });

        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, "Custom help text");
    });

    it("should handle errors gracefully", async () => {
        const registry = new ToolRegistry();
        registry.register("broken", "Broken tool", () => { throw new Error("boom"); });

        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        const result = await router.routeIntent(12345, { action: "broken" });

        expect(result).toBe(false);
        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("boom"));
    });
});

describe("End-to-End: Parse → Route", () => {
    it("should parse and route a payment intent", async () => {
        const parser = new IntentParser();
        const handler = vi.fn();
        const registry = new ToolRegistry();
        registry.register("create_payment", "Send USDC", handler);

        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        const intent = await parser.parse(1, "send 5 usdc jack");
        await router.routeIntent(12345, intent);

        expect(handler).toHaveBeenCalledWith(12345, expect.objectContaining({
            action: "create_payment", amount: 5, beneficiary: "jack"
        }));
    });

    it("should parse and route a request intent", async () => {
        const parser = new IntentParser();
        const handler = vi.fn();
        const registry = new ToolRegistry();
        registry.register("create_payment_request", "Request", handler);

        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        const intent = await parser.parse(1, "request 10 usdc");
        await router.routeIntent(12345, intent);

        expect(handler).toHaveBeenCalledWith(12345, expect.objectContaining({
            action: "create_payment_request", amount: 10
        }));
    });

    it("should fallback with contextual help for unrecognized messages", async () => {
        const parser = new IntentParser();
        const registry = new ToolRegistry();
        const mockBot = { sendMessage: vi.fn() } as any;
        const router = new ToolRouter(mockBot, registry);

        const intent = await parser.parse(1, "xyzabc123");
        await router.routeIntent(12345, intent);

        expect(mockBot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining("/help"));
    });
});
