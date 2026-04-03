import { z } from "zod";
import "dotenv/config";

const hex64 = z.string().regex(/^[a-fA-F0-9]{64}$/, "Must be 64-char hex");
const ethAddr = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be valid Ethereum address");

const schema = z.object({
    // Telegram
    TELEGRAM_TOKEN: z.string().min(1),
    TELEGRAM_BOT_USERNAME: z.string().optional(), // e.g. "ArcPayAgentBot"
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    ALLOWED_CHAT_IDS: z.string().optional(),

    // Circle
    CIRCLE_API_KEY: z.string().min(1),
    CIRCLE_ENTITY_SECRET: hex64,
    CIRCLE_WALLET_SET_ID: z.string().uuid(),
    CIRCLE_API_URL: z.string().url().default("https://api.circle.com/v1/w3s"),

    // Arc Network
    ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
    ARC_CHAIN_ID: z.coerce.number().default(5042002),
    ARC_GAS_RESERVE_USDC: z.string().default("0.10"),

    // Contracts
    PAYABLES_ROUTER_ADDRESS: ethAddr,
    USDC_ADDRESS: ethAddr.default("0x3600000000000000000000000000000000000000"),
    EURC_ADDRESS: ethAddr.default("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"),

    // ERC-8004 Registries
    ERC8004_IDENTITY_REGISTRY: ethAddr.default("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
    ERC8004_REPUTATION_REGISTRY: ethAddr.default("0x8004B663056A597Dffe9eCcC1965A193B7388713"),
    ERC8004_VALIDATION_REGISTRY: ethAddr.default("0x8004Cb1BF31DAf7788923b405b754f57acEB4272"),

    // Agent Identity (optional)
    ARC_AGENT_METADATA_URI: z.string().optional(),
    ARC_AGENT_OWNER_WALLET_ID: z.string().optional(),
    ARC_AGENT_VALIDATOR_WALLET_ID: z.string().optional(),
    ARC_AGENT_ID: z.string().optional(),
    ARC_AGENT_WALLET_SET_NAME: z.string().optional(),

    // Security
    LLM_KEY_SECRET: z.string().min(1),

    // Database (optional — defaults to SQLite)
    DATABASE_URL: z.string().optional(),

    // FX API
    FX_API_BASE_URL: z.string().url().default("https://api.frankfurter.dev/v1"),

    // Polling intervals (ms)
    SCHEDULER_INTERVAL_MS: z.coerce.number().default(10_000),
    WATCHER_INTERVAL_MS: z.coerce.number().default(30_000),
    ALERTER_INTERVAL_MS: z.coerce.number().default(60_000),

    // LLM
    MAX_AGENT_ITERATIONS: z.coerce.number().default(4),

    // Mode
    WEBHOOK_URL: z.string().url().optional(),
    PORT: z.coerce.number().default(3000),
});

export type Config = z.infer<typeof schema>;

let _config: Config | null = null;

export function loadConfig(): Config {
    if (_config) return _config;
    _config = schema.parse(process.env);
    return _config;
}

export function getConfig(): Config {
    if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
    return _config;
}
