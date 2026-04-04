import { logger } from "../utils/logger";
import { actionSchemas } from "./schemas";

export type ActionHandler = (chatId: number, params: Record<string, any>) => Promise<void>;
export type ActionResult = { success: boolean; error?: string };

const registry = new Map<string, ActionHandler>();

export function registerAction(name: string, handler: ActionHandler): void {
    registry.set(name, handler);
}

export async function executeAction(chatId: number, name: string, params: Record<string, any>): Promise<ActionResult> {
    const handler = registry.get(name);
    if (!handler) {
        logger.warn(chatId, `[ActionRegistry] Unknown action: ${name}`);
        return { success: false, error: `Unknown action: ${name}` };
    }

    // Validate params if schema exists (coerces types, applies defaults)
    const schema = actionSchemas[name];
    if (schema) {
        const parsed = schema.safeParse(params);
        if (!parsed.success) {
            const msg = parsed.error.issues.map((i: any) => i.message).join("; ");
            logger.warn(chatId, `[ActionRegistry] Validation failed: ${name}`, { msg });
            return { success: false, error: msg };
        }
        params = parsed.data as Record<string, any>;
    }

    await handler(chatId, params);
    return { success: true };
}

export function hasAction(name: string): boolean {
    return registry.has(name);
}
