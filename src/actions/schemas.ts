import { z } from "zod";

/**
 * Zod schemas for critical actions that take user-facing parameters.
 * z.coerce.number() handles LLM sending "50" as string → auto-converts to 50.
 * Actions without schemas (show_wallet, list_vendors, etc.) are not validated here.
 */
export const actionSchemas: Record<string, z.ZodSchema> = {
    create_payment: z.object({
        beneficiary: z.string().min(1),
        amount: z.coerce.number().positive(),
        token: z.enum(["USDC", "EURC"]).default("USDC"),
        memo: z.string().optional(),
    }),
    schedule_payment: z.object({
        beneficiary: z.string().min(1),
        amount: z.coerce.number().positive(),
        token: z.enum(["USDC", "EURC"]).default("USDC"),
        frequency: z.enum(["once", "daily", "weekly", "monthly"]).default("once"),
        schedule_time: z.string().optional(),
    }),
    save_vendor: z.object({
        name: z.string().min(1),
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    }),
    set_price_alert: z.object({
        symbol: z.string().min(1),
        target_price: z.coerce.number().positive(),
        direction: z.enum(["above", "below"]),
    }),
    cancel_schedule: z.object({
        schedule_id: z.string().min(1),
    }),
    create_payment_request: z.object({
        amount: z.coerce.number().positive(),
        token: z.enum(["USDC", "EURC"]).default("USDC"),
    }),
    get_crypto_prices: z.object({
        symbols: z.string().min(1),
    }),
    get_fx_rate: z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        amount: z.coerce.number().optional(),
    }),
};
