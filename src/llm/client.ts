import { logger } from "../utils/logger";
import { toolsForOpenAI, toolsForAnthropic, toolsForGemini } from "./tools";
import type { ChatMessage } from "../memory/conversation";

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;

export interface ToolCallResponse {
    toolName: string | null;
    toolArgs: Record<string, any>;
    message: string | null;
    finishReason: "tool_calls" | "stop";
    usage?: { promptTokens: number; completionTokens: number };
    latencyMs?: number;
}

export interface LLMAuth {
    provider: string;
    key: string;
    model?: string;
}

// ---- Tool-calling completion ----

export async function requestToolCompletion(
    auth: LLMAuth,
    messages: Array<{ role: string; content: string }>,
): Promise<ToolCallResponse> {
    const start = Date.now();
    const p = auth.provider.toLowerCase();

    try {
        if (p === "anthropic") return await callAnthropicTools(auth, messages, start);
        if (p === "gemini") return await callGeminiTools(auth, messages, start);
        return await callOpenAITools(auth, messages, start);
    } catch (err: any) {
        // 404 = model not found → retry once with provider's default model
        if (err.message?.includes("404") && auth.model) {
            const fallback = defaultModel(p);
            logger.warn(null, "[LLM] Model not found, falling back", { model: auth.model, fallback, provider: p });
            const fallbackAuth = { ...auth, model: fallback };
            if (p === "anthropic") return callAnthropicTools(fallbackAuth, messages, start);
            if (p === "gemini") return callGeminiTools(fallbackAuth, messages, start);
            return callOpenAITools(fallbackAuth, messages, start);
        }
        throw err;
    }
}

// ---- JSON completion (for research synthesis) ----

export async function requestJsonCompletion(
    auth: LLMAuth,
    messages: Array<{ role: string; content: string }>,
): Promise<string | null> {
    const p = auth.provider.toLowerCase();
    if (p === "anthropic") return callAnthropicJson(auth, messages);
    if (p === "gemini") return callGeminiJson(auth, messages);
    return callOpenAIJson(auth, messages);
}

// ---- OpenAI-compatible (OpenAI, Groq, DeepSeek, Together, Mistral, OpenRouter, Qwen) ----

function openaiBaseUrl(provider: string): string {
    const map: Record<string, string> = {
        openai: "https://api.openai.com/v1",
        groq: "https://api.groq.com/openai/v1",
        deepseek: "https://api.deepseek.com/v1",
        together: "https://api.together.xyz/v1",
        mistral: "https://api.mistral.ai/v1",
        openrouter: "https://openrouter.ai/api/v1",
        qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    };
    return map[provider] || map.openai;
}

function defaultModel(provider: string): string {
    const map: Record<string, string> = {
        openai: "gpt-4.1-mini", groq: "llama-3.3-70b-versatile",
        deepseek: "deepseek-chat", together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        mistral: "mistral-small-latest", openrouter: "anthropic/claude-sonnet-4",
        qwen: "qwen-plus", anthropic: "claude-sonnet-4-20250514", gemini: "gemini-2.0-flash",
    };
    return map[provider] || "gpt-4.1-mini";
}

async function callOpenAITools(auth: LLMAuth, messages: any[], start: number): Promise<ToolCallResponse> {
    const base = openaiBaseUrl(auth.provider);
    const model = auth.model || defaultModel(auth.provider);

    const body = { model, messages, tools: toolsForOpenAI(), tool_choice: "auto" };
    const res = await postJson(`${base}/chat/completions`, auth.key, body);

    const choice = res.choices?.[0];
    const tc = choice?.message?.tool_calls?.[0];
    const usage = res.usage;

    return {
        toolName: tc?.function?.name || null,
        toolArgs: tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {},
        message: choice?.message?.content || null,
        finishReason: tc ? "tool_calls" : "stop",
        usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : undefined,
        latencyMs: Date.now() - start,
    };
}

async function callOpenAIJson(auth: LLMAuth, messages: any[]): Promise<string | null> {
    const base = openaiBaseUrl(auth.provider);
    const model = auth.model || defaultModel(auth.provider);

    const body = { model, messages, response_format: { type: "json_object" } };
    const res = await postJson(`${base}/chat/completions`, auth.key, body);
    return res.choices?.[0]?.message?.content ?? null;
}

// ---- Anthropic ----

async function callAnthropicTools(auth: LLMAuth, messages: any[], start: number): Promise<ToolCallResponse> {
    const model = auth.model || defaultModel("anthropic");
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const chatMsgs = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
    }));

    const body = { model, max_tokens: 1024, system: systemMsg, messages: chatMsgs, tools: toolsForAnthropic() };
    const res = await postJson("https://api.anthropic.com/v1/messages", auth.key, body, {
        "anthropic-version": "2023-06-01",
    });

    const toolBlock = res.content?.find((b: any) => b.type === "tool_use");
    const textBlock = res.content?.find((b: any) => b.type === "text");

    return {
        toolName: toolBlock?.name || null,
        toolArgs: toolBlock?.input || {},
        message: textBlock?.text || null,
        finishReason: toolBlock ? "tool_calls" : "stop",
        usage: res.usage ? { promptTokens: res.usage.input_tokens, completionTokens: res.usage.output_tokens } : undefined,
        latencyMs: Date.now() - start,
    };
}

async function callAnthropicJson(auth: LLMAuth, messages: any[]): Promise<string | null> {
    const model = auth.model || defaultModel("anthropic");
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const chatMsgs = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
    }));

    const body = { model, max_tokens: 1024, system: systemMsg, messages: chatMsgs };
    const res = await postJson("https://api.anthropic.com/v1/messages", auth.key, body, {
        "anthropic-version": "2023-06-01",
    });
    return res.content?.[0]?.text ?? null;
}

// ---- Gemini ----

async function callGeminiTools(auth: LLMAuth, messages: any[], start: number): Promise<ToolCallResponse> {
    const model = auth.model || defaultModel("gemini");
    const contents = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
    const systemInstruction = messages.find((m: any) => m.role === "system")?.content;

    const body: any = { contents, tools: toolsForGemini() };
    if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${auth.key}`;
    const res = await postJson(url, "", body);

    const part = res.candidates?.[0]?.content?.parts?.[0];
    const fc = part?.functionCall;

    return {
        toolName: fc?.name || null,
        toolArgs: fc?.args || {},
        message: part?.text || null,
        finishReason: fc ? "tool_calls" : "stop",
        usage: res.usageMetadata ? {
            promptTokens: res.usageMetadata.promptTokenCount || 0,
            completionTokens: res.usageMetadata.candidatesTokenCount || 0,
        } : undefined,
        latencyMs: Date.now() - start,
    };
}

async function callGeminiJson(auth: LLMAuth, messages: any[]): Promise<string | null> {
    const model = auth.model || defaultModel("gemini");
    const contents = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
    const systemInstruction = messages.find((m: any) => m.role === "system")?.content;

    const body: any = {
        contents,
        generationConfig: { responseMimeType: "application/json" },
    };
    if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${auth.key}`;
    const res = await postJson(url, "", body);
    return res.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

// ---- HTTP helper ----

async function postJson(url: string, apiKey: string, body: any, extraHeaders?: Record<string, string>): Promise<any> {
    for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

            const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
            if (apiKey) {
                if (url.includes("anthropic.com")) headers["x-api-key"] = apiKey;
                else if (!url.includes("key=")) headers["Authorization"] = `Bearer ${apiKey}`;
            }

            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
            }
            return await res.json();
        } catch (err: any) {
            if (attempt === DEFAULT_RETRIES) throw err;
            const backoff = err.name === "AbortError" ? 3000 : 500 * (attempt + 1);
            logger.warn(null, `[LLM] Retry ${attempt + 1}`, { error: err.message });
            await new Promise(r => setTimeout(r, backoff));
        }
    }
}
