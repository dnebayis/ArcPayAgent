import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../src/config";

const validEnv = {
    ARC_RPC_URL: "https://rpc.testnet.arc.network",
    PAYABLES_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000001",
    USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
    LLM_KEY_SECRET: "test-llm-secret",
    CIRCLE_API_KEY: "test-circle-key",
    CIRCLE_ENTITY_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    CIRCLE_WALLET_SET_ID: "wallet-set-123",
    CIRCLE_API_URL: "https://api.circle.com/v1/w3s",
};

describe("loadRuntimeConfig", () => {
    it("should parse a valid production config", () => {
        const config = loadRuntimeConfig(validEnv, { isTest: false });

        expect(config.ARC_RPC_URL).toBe(validEnv.ARC_RPC_URL);
        expect(config.USDC_ADDRESS).toBe(validEnv.USDC_ADDRESS);
        expect(config.PAYABLES_ROUTER_ADDRESS).toBe(validEnv.PAYABLES_ROUTER_ADDRESS);
    });

    it("should reject missing required addresses", () => {
        expect(() => loadRuntimeConfig({
            ...validEnv,
            USDC_ADDRESS: ""
        }, { isTest: false })).toThrow(/USDC_ADDRESS is required/);
    });

    it("should reject invalid contract addresses", () => {
        expect(() => loadRuntimeConfig({
            ...validEnv,
            PAYABLES_ROUTER_ADDRESS: "0x123"
        }, { isTest: false })).toThrow(/PAYABLES_ROUTER_ADDRESS must be a valid EVM address/);
    });

    it("should reject malformed entity secrets", () => {
        expect(() => loadRuntimeConfig({
            ...validEnv,
            CIRCLE_ENTITY_SECRET: "not-hex"
        }, { isTest: false })).toThrow(/CIRCLE_ENTITY_SECRET must be a 32-byte hex string/);
    });

    it("should provide safe defaults in test mode", () => {
        const config = loadRuntimeConfig({}, { isTest: true });

        expect(config.ARC_RPC_URL).toBe("https://rpc.testnet.arc.network");
        expect(config.USDC_ADDRESS).toBe("0x0000000000000000000000000000000000000000");
        expect(config.CIRCLE_API_URL).toBe("https://api.circle.com/v1/w3s");
    });
});
