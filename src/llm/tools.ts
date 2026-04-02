/**
 * Tool definitions for LLM native tool-calling.
 * English only. No Turkish examples.
 */

export interface ToolDef {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required: string[];
    };
}

export const TERMINAL_ACTIONS = new Set([
    "create_payment", "schedule_payment", "cancel_schedule", "cancel_all_schedules",
    "create_wallet", "export_wallet",
    "save_vendor", "remove_vendor", "remove_all_vendors",
    "list_vendors", "show_wallet", "wallet_intelligence",
    "report", "spending_by_vendor", "monthly_spending", "show_recent_payments", "account_summary", "status",
    "list_schedules", "vendor_detail", "top_vendors",
    "set_price_alert", "list_price_alerts", "remove_price_alert", "remove_all_price_alerts",
    "watch_payments_enable", "watch_payments_disable", "watch_payments_status",
    "get_crypto_prices", "get_fx_rate", "get_arc_network_stats", "get_my_arc_activity",
    "agent_status", "agent_identity", "agent_validation_status",
    "create_payment_request", "analyze_invoice",
]);

export const TOOL_DEFINITIONS: ToolDef[] = [
    {
        name: "create_payment",
        description: "Prepare a USDC or EURC payment for the user to confirm. Requires explicit amount. NEVER call when flowState=awaiting_confirmation.",
        parameters: {
            type: "object",
            properties: {
                beneficiary: { type: "string", description: "Vendor name or 0x address" },
                amount: { type: "number", description: "Payment amount (e.g., 5.50)" },
                token: { type: "string", description: "Token symbol", enum: ["USDC", "EURC"] },
                memo: { type: "string", description: "Payment memo" },
            },
            required: ["beneficiary", "amount"],
        },
    },
    {
        name: "schedule_payment",
        description: "Schedule a recurring or one-time future payment. Creates immediately, no confirm step.",
        parameters: {
            type: "object",
            properties: {
                beneficiary: { type: "string", description: "Vendor name or address" },
                amount: { type: "number", description: "Payment amount" },
                token: { type: "string", description: "Token", enum: ["USDC", "EURC"] },
                frequency: { type: "string", description: "Frequency", enum: ["once", "daily", "weekly", "monthly"] },
                schedule_time: { type: "string", description: "When to execute. Always combine day+time: 'tomorrow 9am', 'next monday 3pm', 'today 14:00'. Never pass bare time like '9:00' alone — use 'today 9:00' or 'tomorrow 9:00'." },
            },
            required: ["beneficiary", "amount", "frequency"],
        },
    },
    {
        name: "cancel_schedule",
        description: "Cancel a specific schedule by ID. Must provide a real ID from list_schedules.",
        parameters: {
            type: "object",
            properties: { schedule_id: { type: "string", description: "Schedule ID to cancel" } },
            required: ["schedule_id"],
        },
    },
    {
        name: "cancel_all_schedules",
        description: "Cancel all active schedules for the user.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "create_wallet",
        description: "Create a new Circle wallet on Arc Testnet for the user.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "show_wallet",
        description: "Show wallet address and USDC/EURC balances.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "export_wallet",
        description: "Show the wallet address for export. Triggered by 'export wallet', 'private key', 'mnemonic'.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "wallet_intelligence",
        description: "Deep portfolio analysis: balances, recent activity, spending patterns, on-chain data.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "save_vendor",
        description: "Save a vendor name with their wallet address.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Vendor name" },
                address: { type: "string", description: "0x wallet address" },
            },
            required: ["name", "address"],
        },
    },
    {
        name: "list_vendors",
        description: "List all saved vendors with addresses and payment stats.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "remove_vendor",
        description: "Remove a saved vendor by name.",
        parameters: {
            type: "object",
            properties: { name: { type: "string", description: "Vendor name to remove" } },
            required: ["name"],
        },
    },
    {
        name: "remove_all_vendors",
        description: "Remove all saved vendors.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "vendor_detail",
        description: "Get detailed info about a specific vendor.",
        parameters: {
            type: "object",
            properties: { name: { type: "string", description: "Vendor name" } },
            required: ["name"],
        },
    },
    {
        name: "top_vendors",
        description: "Show top vendors by total amount paid.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "report",
        description: "Generate a spending report with totals and top vendors.",
        parameters: {
            type: "object",
            properties: { period: { type: "string", description: "Time period", enum: ["week", "month", "all"] } },
            required: [],
        },
    },
    {
        name: "spending_by_vendor",
        description: "Breakdown of spending grouped by vendor.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "monthly_spending",
        description: "Month-by-month spending breakdown.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "show_recent_payments",
        description: "Show last 10 payments.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "account_summary",
        description: "Full account overview: balance, vendors, schedules, recent payments.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "status",
        description: "Quick status check: wallet, balance, active schedules count.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "list_schedules",
        description: "List all active payment schedules.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "get_crypto_prices",
        description: "Look up current prices of cryptocurrencies.",
        parameters: {
            type: "object",
            properties: { symbols: { type: "string", description: "Comma-separated symbols (e.g., 'BTC,ETH,SOL')" } },
            required: ["symbols"],
        },
    },
    {
        name: "get_fx_rate",
        description: "Get foreign exchange rate between two currencies.",
        parameters: {
            type: "object",
            properties: {
                from: { type: "string", description: "Source currency (e.g., EUR)" },
                to: { type: "string", description: "Target currency (e.g., USD)" },
                amount: { type: "number", description: "Amount to convert" },
            },
            required: ["from", "to"],
        },
    },
    {
        name: "get_arc_network_stats",
        description: "Get Arc network statistics: latest block, chain ID.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "get_my_arc_activity",
        description: "Get user's on-chain activity on Arc: recent transactions, payment history.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "set_price_alert",
        description: "Set a price alert for a cryptocurrency.",
        parameters: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Crypto symbol (e.g., BTC)" },
                target_price: { type: "number", description: "Target price in USD" },
                direction: { type: "string", description: "Alert when price goes above or below target", enum: ["above", "below"] },
            },
            required: ["symbol", "target_price", "direction"],
        },
    },
    {
        name: "list_price_alerts",
        description: "List all active price alerts.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "remove_price_alert",
        description: "Remove a price alert by ID.",
        parameters: {
            type: "object",
            properties: { alert_id: { type: "string", description: "Alert ID to remove" } },
            required: ["alert_id"],
        },
    },
    {
        name: "remove_all_price_alerts",
        description: "Remove all price alerts.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "watch_payments_enable",
        description: "Enable incoming payment notifications for the user's wallet.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "watch_payments_disable",
        description: "Disable incoming payment notifications.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "watch_payments_status",
        description: "Check if wallet payment notifications are enabled.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "create_payment_request",
        description: "Create a shareable payment request link.",
        parameters: {
            type: "object",
            properties: {
                amount: { type: "number", description: "Amount to request" },
                token: { type: "string", description: "Token", enum: ["USDC", "EURC"] },
            },
            required: ["amount"],
        },
    },
    {
        name: "analyze_invoice",
        description: "Analyze an uploaded invoice (PDF or image) for payment preparation.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "agent_status",
        description: "Check the on-chain agent registration status (ERC-8004).",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "agent_identity",
        description: "Show agent identity details: wallet addresses, metadata URI, agent ID.",
        parameters: { type: "object", properties: {}, required: [] },
    },
    {
        name: "agent_validation_status",
        description: "Check the KYC validation status for the agent.",
        parameters: { type: "object", properties: {}, required: [] },
    },
];

/**
 * Format tool definitions for different LLM providers.
 */
export function toolsForOpenAI(): any[] {
    return TOOL_DEFINITIONS.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

export function toolsForAnthropic(): any[] {
    return TOOL_DEFINITIONS.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
}

export function toolsForGemini(): any[] {
    return [{
        function_declarations: TOOL_DEFINITIONS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        })),
    }];
}
