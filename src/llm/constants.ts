/**
 * Shared LLM provider and model constants.
 * Single source of truth — used by orchestrator, actions, telegram handlers, and tool schemas.
 */

export const VALID_PROVIDERS: string[] = [
    "openai", "anthropic", "gemini", "groq", "deepseek",
    "together", "mistral", "openrouter", "qwen",
];

export const DEFAULT_MODELS: Record<string, string[]> = {
    openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3-mini"],
    anthropic: ["claude-sonnet-4-20250514", "claude-haiku-4-20250414", "claude-3-5-sonnet-20241022"],
    gemini: ["gemini-2.0-flash", "gemini-2.5-pro-preview-06-05", "gemini-2.5-flash-preview-05-20"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    mistral: ["mistral-small-latest", "mistral-large-latest"],
    openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"],
    qwen: ["qwen-plus", "qwen-turbo", "qwen-max"],
};
