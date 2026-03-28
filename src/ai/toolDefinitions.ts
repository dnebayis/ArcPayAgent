export interface ToolParam {
    type: string;
    description: string;
    enum?: string[];
    items?: { type: string };
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, ToolParam>;
        required?: string[];
    };
}

/** Actions where the dispatcher handles the full UX (inline keyboards etc.).
 *  After executing these, the agent loop does NOT attempt a synthesis step. */
export const TERMINAL_ACTIONS = new Set([
    // Payment flow — two-step confirm UI; loop must stop here
    "create_payment",
    "create_wallet",
    "create_payment_request",
    // Research — fetch + display inline; no follow-up tool needed
    "get_crypto_prices",
    "get_arc_network_stats",
    "get_my_arc_activity",
    "get_fx_rate",
    // Write actions — send their own confirmation message; no chaining needed
    "schedule_payment",
    "cancel_schedule",
    "cancel_all_schedules",
    "save_vendor",
    "remove_vendor",
    "remove_all_vendors",
    "watch_payments_enable",
    "watch_payments_disable",
    "set_price_alert",
    "remove_price_alert",
    "remove_all_price_alerts",
    "export_wallet",
    "analyze_invoice",
    // Data-display actions — engine sends formatted message directly; loop must stop here
    // to prevent the LLM generating a second (fabricated) response
    "list_schedules",
    "list_vendors",
    "show_wallet",
    "wallet_intelligence",
    "monthly_spending",
    "payment_history",
    "show_recent_payments",
    "report",
    "spending_by_vendor",
    "top_vendors",
    "account_summary",
    "vendor_detail",
    "show_pending_payments",
    "status",
    "agent_status",
    "agent_identity",
    "agent_validation_status",
    "watch_payments_status",
    "list_price_alerts",
]);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
    // === Payments ===
    {
        name: "create_payment",
        description: "Prepare a USDC or EURC payment for the user to confirm. Requires explicit amount. NEVER call this unless the user specified a concrete number. NEVER call when a payment is already awaiting confirmation (flowState=payment_awaiting_confirmation).",
        parameters: {
            type: "object",
            properties: {
                amount: { type: "number", description: "Payment amount (positive number, explicitly stated by user)" },
                beneficiary: { type: "string", description: "Recipient name (vendor name) or 0x address" },
                token: { type: "string", description: "USDC or EURC", enum: ["USDC", "EURC"] },
                memo: { type: "string", description: "Optional payment memo" },
                message: { type: "string", description: "Brief conversational message to show the user before the payment card" },
            },
            required: ["amount", "beneficiary"],
        },
    },
    {
        name: "schedule_payment",
        description: "Schedule a one-time or recurring USDC/EURC payment. The schedule is created IMMEDIATELY — there is NO confirmation step. Do NOT write a review card or say 'use the Confirm button'. Just say e.g. 'Scheduling X USDC to Y for Z.'",
        parameters: {
            type: "object",
            properties: {
                amount: { type: "number", description: "Payment amount" },
                beneficiary: { type: "string", description: "Recipient name or 0x address" },
                token: { type: "string", enum: ["USDC", "EURC"], description: "Token to use" },
                frequency: { type: "string", enum: ["once", "weekly", "monthly"], description: "How often to repeat" },
                schedule_time: { type: "string", description: "When to execute, e.g. 'tomorrow 9:00', 'next monday', 'in 3 hours'" },
                message: { type: "string", description: "Brief conversational message to show" },
            },
            required: ["amount", "beneficiary", "frequency"],
        },
    },
    {
        name: "cancel_schedule",
        description: "Cancel a specific scheduled payment by its ID",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Schedule ID to cancel" },
                message: { type: "string", description: "Brief conversational message to show" },
            },
            required: ["name"],
        },
    },
    {
        name: "cancel_all_schedules",
        description: "Cancel ALL scheduled payments",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message to show" } } },
    },
    {
        name: "list_schedules",
        description: "List all active scheduled payments",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message to show" } } },
    },
    {
        name: "create_payment_request",
        description: "Create a shareable payment request link for a given USDC amount",
        parameters: {
            type: "object",
            properties: {
                amount: { type: "number", description: "Amount to request" },
                message: { type: "string", description: "Brief message to show" },
            },
            required: ["amount"],
        },
    },
    {
        name: "show_pending_payments",
        description: "Show currently pending (unconfirmed) payments",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message to show" } } },
    },
    // === Vendors ===
    {
        name: "save_vendor",
        description: "Save a vendor name and their wallet address. Both name AND valid 0x address required — ask for whichever is missing.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Vendor name" },
                address: { type: "string", description: "Vendor's 0x wallet address" },
                message: { type: "string", description: "Brief message to show" },
            },
            required: ["name", "address"],
        },
    },
    {
        name: "list_vendors",
        description: "List all saved vendors with their addresses",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "remove_vendor",
        description: "Remove a saved vendor by name",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Vendor name to remove" },
                message: { type: "string", description: "Brief message" },
            },
            required: ["name"],
        },
    },
    {
        name: "remove_all_vendors",
        description: "Remove ALL saved vendors",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "vendor_detail",
        description: "Show detailed info about a specific vendor (address, payment history)",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Vendor name to look up" },
                message: { type: "string", description: "Brief message" },
            },
            required: ["name"],
        },
    },
    {
        name: "top_vendors",
        description: "Show top vendors ranked by total USDC paid",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    // === Wallet ===
    {
        name: "create_wallet",
        description: "Create a new Circle MPC wallet for the user on Arc Testnet",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "show_wallet",
        description: "Show the user's wallet address and current USDC/EURC balances",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "export_wallet",
        description: "Explain why MPC wallets cannot export private keys (use when user asks for seed phrase or private key)",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "wallet_intelligence",
        description: "Deep wallet analysis with on-chain DeFi insights and portfolio breakdown. Use only when user asks for detailed portfolio or activity analysis.",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    // === Analytics ===
    {
        name: "report",
        description: "Show spending report for the current month",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "spending_by_vendor",
        description: "Show spending breakdown grouped by vendor",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "payment_history",
        description: "Show payment history",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "show_recent_payments",
        description: "Show the most recent payments (last 5-10). Also use for 'did it go through?' after a payment.",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "monthly_spending",
        description: "Show month-by-month spending breakdown",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "account_summary",
        description: "Show all-time account summary with vendor breakdown",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "status",
        description: "Show agent operations overview",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    // === Agent Identity ===
    {
        name: "agent_status",
        description: "Show agent's on-chain ERC-8004 registration status, token ID, and identity. ONLY use for explicit queries about agent ID / token ID / on-chain identity. NEVER use for capability queries.",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "agent_identity",
        description: "Show agent identity details",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "agent_validation_status",
        description: "Show agent validation status on Arc",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    // === Live Research ===
    {
        name: "get_crypto_prices",
        description: "Fetch live cryptocurrency prices. symbols must be crypto tickers (BTC, ETH, SOL) — NEVER fiat codes.",
        parameters: {
            type: "object",
            properties: {
                symbols: { type: "array", items: { type: "string" }, description: "Crypto ticker symbols, e.g. [\"BTC\",\"ETH\"]" },
                message: { type: "string", description: "Brief message like 'Checking BTC price.'" },
            },
            required: ["symbols"],
        },
    },
    {
        name: "get_arc_network_stats",
        description: "Fetch live Arc network status (block number, uptime). ONLY for: 'is Arc up?', 'latest block?', 'is the network healthy?'. NEVER for Arc knowledge questions — answer those from your knowledge.",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "get_my_arc_activity",
        description: "Show the user's on-chain activity on Arc Testnet",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "get_fx_rate",
        description: "Get fiat-to-fiat exchange rate. Use ISO 4217 codes. NEVER use crypto tickers here.",
        parameters: {
            type: "object",
            properties: {
                from: { type: "string", description: "Source currency ISO code (e.g. TRY, EUR)" },
                to: { type: "string", description: "Target currency ISO code (e.g. USD, GBP)" },
                amount: { type: "number", description: "Amount to convert" },
                message: { type: "string", description: "Brief message" },
            },
            required: ["from", "to", "amount"],
        },
    },
    // === Incoming Payment Watch ===
    {
        name: "watch_payments_enable",
        description: "Enable notifications for incoming USDC/EURC payments to the user's wallet",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "watch_payments_disable",
        description: "Disable incoming payment notifications",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "watch_payments_status",
        description: "Check if incoming payment notifications are enabled",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    // === Price Alerts ===
    {
        name: "set_price_alert",
        description: "Set a price alert that notifies user when a crypto asset crosses a threshold",
        parameters: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Crypto ticker, e.g. BTC" },
                alert_price: { type: "number", description: "Target price in USD" },
                alert_direction: { type: "string", enum: ["above", "below"], description: "Trigger direction" },
                message: { type: "string", description: "Brief message" },
            },
            required: ["symbol", "alert_price", "alert_direction"],
        },
    },
    {
        name: "list_price_alerts",
        description: "List all active price alerts",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    {
        name: "remove_price_alert",
        description: "Remove a specific price alert by ID",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Alert ID to remove" },
                message: { type: "string", description: "Brief message" },
            },
            required: ["name"],
        },
    },
    {
        name: "remove_all_price_alerts",
        description: "Remove all price alerts",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
    // === Invoice ===
    {
        name: "analyze_invoice",
        description: "Tell user to send an invoice PDF or photo for analysis",
        parameters: { type: "object", properties: { message: { type: "string", description: "Brief message" } } },
    },
];

/** Convert to Anthropic tool format */
export function toAnthropicTools(tools: ToolDefinition[]): object[] {
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
}

/** Convert to Gemini function declaration format */
export function toGeminiFunctions(tools: ToolDefinition[]): object[] {
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }));
}
