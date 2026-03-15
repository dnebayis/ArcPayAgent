import { ethers } from "ethers";
import { z } from "zod";
import { ARC_TESTNET_RPC_URL } from "./blockchain/arcConfig";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_CIRCLE_API_URL = "https://api.circle.com/v1/w3s";

const requiredString = (name: string) => z.string().trim().min(1, `${name} is required`);
const evmAddress = (name: string) =>
    requiredString(name).refine((value) => ethers.isAddress(value), `${name} must be a valid EVM address`);

const productionSchema = z.object({
    TELEGRAM_TOKEN: z.string().trim().optional(),
    BOT_USERNAME: z.string().trim().min(1).optional().default("ArcPayAgentBot"),
    ARC_RPC_URL: z.string().trim().url("ARC_RPC_URL must be a valid URL").default(ARC_TESTNET_RPC_URL),
    PAYABLES_ROUTER_ADDRESS: evmAddress("PAYABLES_ROUTER_ADDRESS"),
    USDC_ADDRESS: evmAddress("USDC_ADDRESS"),
    LLM_KEY_SECRET: requiredString("LLM_KEY_SECRET"),
    CIRCLE_API_KEY: requiredString("CIRCLE_API_KEY"),
    CIRCLE_ENTITY_SECRET: requiredString("CIRCLE_ENTITY_SECRET").regex(/^[0-9a-fA-F]{64}$/, "CIRCLE_ENTITY_SECRET must be a 32-byte hex string"),
    CIRCLE_WALLET_SET_ID: requiredString("CIRCLE_WALLET_SET_ID"),
    CIRCLE_API_URL: z.string().trim().url("CIRCLE_API_URL must be a valid URL").default(DEFAULT_CIRCLE_API_URL),
});

const testSchema = z.object({
    TELEGRAM_TOKEN: z.string().trim().optional(),
    BOT_USERNAME: z.string().trim().optional().default("ArcPayAgentBot"),
    ARC_RPC_URL: z.string().trim().optional().default(ARC_TESTNET_RPC_URL),
    PAYABLES_ROUTER_ADDRESS: z.string().trim().optional().default(ZERO_ADDRESS),
    USDC_ADDRESS: z.string().trim().optional().default(ZERO_ADDRESS),
    LLM_KEY_SECRET: z.string().trim().optional().default("test-llm-secret"),
    CIRCLE_API_KEY: z.string().trim().optional().default("test-circle-key"),
    CIRCLE_ENTITY_SECRET: z.string().trim().optional().default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
    CIRCLE_WALLET_SET_ID: z.string().trim().optional().default("test-wallet-set"),
    CIRCLE_API_URL: z.string().trim().optional().default(DEFAULT_CIRCLE_API_URL),
});

export type RuntimeConfig = z.infer<typeof productionSchema>;

function formatError(error: z.ZodError): string {
    return error.issues.map((issue) => issue.message).join("; ");
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env, options?: { isTest?: boolean }): RuntimeConfig {
    const isTest = options?.isTest ?? env.NODE_ENV === "test";
    const schema = isTest ? testSchema : productionSchema;
    const parsed = schema.safeParse(env);

    if (!parsed.success) {
        throw new Error(`Invalid runtime configuration: ${formatError(parsed.error)}`);
    }

    return parsed.data as RuntimeConfig;
}
