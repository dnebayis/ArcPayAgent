import { logger } from "../utils/logger";

export type ActionHandler = (chatId: number, params: Record<string, any>) => Promise<void>;

const registry = new Map<string, ActionHandler>();

export function registerAction(name: string, handler: ActionHandler): void {
    registry.set(name, handler);
}

export async function executeAction(chatId: number, name: string, params: Record<string, any>): Promise<void> {
    const handler = registry.get(name);
    if (!handler) {
        logger.warn(chatId, `[ActionRegistry] Unknown action: ${name}`);
        return;
    }
    await handler(chatId, params);
}

export function hasAction(name: string): boolean {
    return registry.has(name);
}
