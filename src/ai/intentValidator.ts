import { ParsedIntent } from "../core/orchestrator";

const KNOWN_ACTIONS = new Set([
    "create_payment", "schedule_payment", "cancel_schedule", "cancel_all_schedules",
    "list_schedules", "show_wallet", "wallet_intelligence", "show_recent_payments",
    "spending_by_vendor", "monthly_spending", "account_summary", "report",
    "save_vendor", "list_vendors", "remove_vendor", "vendor_detail",
    "get_crypto_prices", "get_arc_network_stats", "get_my_arc_activity", "get_fx_rate",
    "agent_status", "watch_payments_enable", "watch_payments_disable", "watch_payments_status",
    "set_price_alert", "list_price_alerts", "remove_price_alert", "remove_all_price_alerts",
    "create_wallet", "payment_request", "analyze_invoice",
    "invpay", "chat",
]);

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Validates a raw LLM-parsed intent object.
 * Returns the validated intent or null if validation fails.
 * Does NOT throw — callers should handle null as "LLM output was malformed".
 */
export function validateIntent(raw: unknown): ParsedIntent | null {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

    const obj = raw as Record<string, unknown>;

    // action — must be a known string (or absent for pure chat responses)
    if (obj.action !== undefined) {
        if (typeof obj.action !== "string") return null;
        if (!KNOWN_ACTIONS.has(obj.action)) {
            // Unknown action — downgrade to chat rather than reject entirely
            obj.action = "chat";
        }
    }

    // amount — must be a finite positive number when present
    if (obj.amount !== undefined) {
        const n = Number(obj.amount);
        if (!isFinite(n) || n <= 0) return null;
        obj.amount = n;
    }

    // beneficiary — string, max 200 chars
    if (obj.beneficiary !== undefined) {
        if (typeof obj.beneficiary !== "string" || obj.beneficiary.length > 200) return null;
    }

    // address — must match EVM format when present
    if (obj.address !== undefined) {
        if (typeof obj.address !== "string" || !EVM_ADDRESS_RE.test(obj.address)) return null;
    }

    // message — must be a string when present
    if (obj.message !== undefined && typeof obj.message !== "string") return null;

    // token — must be USDC or EURC when present
    if (obj.token !== undefined && obj.token !== "USDC" && obj.token !== "EURC") {
        delete obj.token; // ignore invalid token — default to USDC downstream
    }

    return obj as unknown as ParsedIntent;
}
