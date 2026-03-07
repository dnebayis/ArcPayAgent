import { ParsedIntent } from "../ai/intentParser";

export type ToolHandler = (chatId: number, intent: ParsedIntent) => Promise<void> | void;

export interface RegisteredTool {
    action: string;
    description: string;
    handler: ToolHandler;
}

export class ToolRegistry {
    private tools: Map<string, RegisteredTool> = new Map();

    register(action: string, description: string, handler: ToolHandler): void {
        this.tools.set(action, { action, description, handler });
    }

    get(action: string): RegisteredTool | undefined {
        return this.tools.get(action);
    }

    has(action: string): boolean {
        return this.tools.has(action);
    }

    listActions(): string[] {
        return Array.from(this.tools.keys());
    }

    listTools(): RegisteredTool[] {
        return Array.from(this.tools.values());
    }
}
