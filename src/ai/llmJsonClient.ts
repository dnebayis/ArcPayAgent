export interface LLMAuthConfig {
    provider: string;
    key: string;
    model?: string;
}

export interface LLMJsonMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

// === TOOL CALLING TYPES ===

export interface ToolCallResponse {
    message?: string;           // assistant's conversational text (optional)
    toolName?: string;          // tool called, undefined if LLM chose to just respond
    toolArgs?: Record<string, unknown>;
    toolCallId?: string;        // id for feeding back tool results
    finishReason: "stop" | "tool_calls";
}

/** Extended message type that supports tool result messages */
export type AgentMessage =
    | LLMJsonMessage
    | { role: "tool"; tool_call_id: string; content: string };

interface OpenAICompatibleConfig {
    apiUrl: string;
    model: string;
    extraHeaders?: Record<string, string>;
}

const DEFAULT_LLM_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_LLM_HTTP_RETRIES = 2;

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNetworkError(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
        if (cause?.code) {
            return `${error.message} (${cause.code})`;
        }
        return error.message;
    }
    return String(error);
}

async function postJsonWithRetry(url: string, init: RequestInit, provider?: string): Promise<Response | null> {
    for (let attempt = 1; attempt <= DEFAULT_LLM_HTTP_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_LLM_HTTP_TIMEOUT_MS);
        try {
            return await fetch(url, {
                ...init,
                signal: controller.signal
            });
        } catch (error) {
            const isLastAttempt = attempt === DEFAULT_LLM_HTTP_RETRIES;
            const providerTag = provider ? ` [${provider}]` : "";
            console.error(`[LLM JSON]${providerTag} network error on attempt ${attempt}/${DEFAULT_LLM_HTTP_RETRIES}: ${formatNetworkError(error)}`);
            if (isLastAttempt) {
                return null;
            }
            // Wait longer on timeout/abort to avoid hammering an overloaded provider
            const isAbort = error instanceof Error && error.name === "AbortError";
            await sleep(isAbort ? 3000 : 500 * attempt);
        } finally {
            clearTimeout(timeout);
        }
    }

    return null;
}

function getOpenAICompatibleConfig(auth: LLMAuthConfig): OpenAICompatibleConfig {
    switch (auth.provider) {
        case "deepseek":
            return { apiUrl: "https://api.deepseek.com/v1/chat/completions", model: auth.model || "deepseek-chat" };
        case "groq":
            return { apiUrl: "https://api.groq.com/openai/v1/chat/completions", model: auth.model || "llama-3.3-70b-versatile" };
        case "qwen":
            return { apiUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", model: auth.model || "qwen3-max" };
        case "openrouter":
            return { apiUrl: "https://openrouter.ai/api/v1/chat/completions", model: auth.model || "openai/gpt-4o-mini" };
        case "together":
            return { apiUrl: "https://api.together.xyz/v1/chat/completions", model: auth.model || "meta-llama/Llama-3.3-70B-Instruct-Turbo" };
        case "mistral":
            return { apiUrl: "https://api.mistral.ai/v1/chat/completions", model: auth.model || "mistral-small-latest" };
        case "openai":
        default:
            return { apiUrl: "https://api.openai.com/v1/chat/completions", model: auth.model || "gpt-4o-mini" };
    }
}

async function callOpenAICompatible(auth: LLMAuthConfig, messages: LLMJsonMessage[]): Promise<string | null> {
    const config = getOpenAICompatibleConfig(auth);
    const response = await postJsonWithRetry(config.apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${auth.key}`,
            ...(config.extraHeaders || {})
        },
        body: JSON.stringify({
            model: config.model,
            messages,
            response_format: { type: "json_object" }
        })
    }, auth.provider);

    if (!response) {
        return null;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM JSON] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
}

async function callAnthropic(auth: LLMAuthConfig, systemContent: string, messages: LLMJsonMessage[]): Promise<string | null> {
    const response = await postJsonWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": auth.key,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model: auth.model || "claude-3-5-sonnet-latest",
            system: `${systemContent}\n\nReturn only valid JSON.`,
            max_tokens: 900,
            messages: messages
                .filter((message) => message.role !== "system")
                .map((message) => ({
                    role: message.role === "assistant" ? "assistant" : "user",
                    content: message.content
                }))
        })
    }, "anthropic");

    if (!response) {
        return null;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM JSON] [anthropic] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json();
    return data.content?.find((item: any) => item?.type === "text")?.text || null;
}

async function callGemini(auth: LLMAuthConfig, systemContent: string, messages: LLMJsonMessage[]): Promise<string | null> {
    const model = auth.model || "gemini-2.0-flash";
    const response = await postJsonWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": auth.key
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: `${systemContent}\n\nReturn only valid JSON.` }]
            },
            contents: messages
                .filter((message) => message.role !== "system")
                .map((message) => ({
                    role: message.role === "assistant" ? "model" : "user",
                    parts: [{ text: message.content }]
                })),
            generationConfig: {
                responseMimeType: "application/json"
            }
        })
    }, "gemini");

    if (!response) {
        return null;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM JSON] [gemini] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.find((item: any) => typeof item?.text === "string")?.text || null;
}

// === TOOL CALLING IMPLEMENTATIONS ===

async function callOpenAICompatibleWithTools(
    auth: LLMAuthConfig,
    messages: AgentMessage[],
    tools: import("./toolDefinitions").ToolDefinition[]
): Promise<ToolCallResponse | null> {
    const config = getOpenAICompatibleConfig(auth);

    // Format messages: tool messages are passed as-is (OpenAI supports role:"tool")
    const formattedMessages = messages.map(m => {
        if (m.role === "tool") {
            return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
        }
        return m;
    });

    const response = await postJsonWithRetry(config.apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${auth.key}`,
            ...(config.extraHeaders || {})
        },
        body: JSON.stringify({
            model: config.model,
            messages: formattedMessages,
            tools: tools.map(t => ({ type: "function", function: t })),
            tool_choice: "auto"
        })
    }, auth.provider);

    if (!response) return null;
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM Tools] [${auth.provider}] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json() as {
        choices?: Array<{
            message?: {
                content?: string | null;
                tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
            };
            finish_reason?: string;
        }>;
    };
    const choice = data.choices?.[0];
    if (!choice?.message) return null;

    const toolCalls = choice.message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        const tc = toolCalls[0];
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* empty args */ }
        return {
            toolName: tc.function.name,
            toolArgs: args,
            toolCallId: tc.id,
            finishReason: "tool_calls",
            message: choice.message.content ?? undefined,
        };
    }

    return {
        message: choice.message.content ?? undefined,
        finishReason: "stop",
    };
}

async function callAnthropicWithTools(
    auth: LLMAuthConfig,
    messages: AgentMessage[],
    tools: import("./toolDefinitions").ToolDefinition[]
): Promise<ToolCallResponse | null> {
    const { toAnthropicTools } = await import("./toolDefinitions");

    // Separate system message from conversation messages
    const systemMessage = messages.find((m): m is LLMJsonMessage => m.role === "system");
    const systemContent = systemMessage?.content ?? "";

    // Convert messages to Anthropic format
    const anthropicMessages: Array<{ role: string; content: string | object[] }> = [];
    for (const m of messages) {
        if (m.role === "system") continue;
        if (m.role === "tool") {
            anthropicMessages.push({
                role: "user",
                content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }]
            });
        } else {
            anthropicMessages.push({ role: m.role, content: m.content });
        }
    }

    const response = await postJsonWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": auth.key,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model: auth.model || "claude-3-5-sonnet-latest",
            system: systemContent,
            max_tokens: 1024,
            messages: anthropicMessages,
            tools: toAnthropicTools(tools),
            tool_choice: { type: "auto" }
        })
    }, "anthropic");

    if (!response) return null;
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM Tools] [anthropic] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json() as {
        content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        stop_reason?: string;
    };

    const textBlock = data.content?.find(b => b.type === "text");
    const toolUseBlock = data.content?.find(b => b.type === "tool_use");

    if (toolUseBlock) {
        return {
            toolName: toolUseBlock.name,
            toolArgs: toolUseBlock.input ?? {},
            toolCallId: toolUseBlock.id,
            finishReason: "tool_calls",
            message: textBlock?.text,
        };
    }

    return {
        message: textBlock?.text,
        finishReason: "stop",
    };
}

async function callGeminiWithTools(
    auth: LLMAuthConfig,
    messages: AgentMessage[],
    tools: import("./toolDefinitions").ToolDefinition[]
): Promise<ToolCallResponse | null> {
    const { toGeminiFunctions } = await import("./toolDefinitions");

    const model = auth.model || "gemini-2.0-flash";
    const systemMessage = messages.find((m): m is LLMJsonMessage => m.role === "system");
    const systemContent = systemMessage?.content ?? "";

    // Convert messages to Gemini format
    const geminiContents: Array<{ role: string; parts: object[] }> = [];
    for (const m of messages) {
        if (m.role === "system") continue;
        if (m.role === "tool") {
            geminiContents.push({
                role: "user",
                parts: [{ functionResponse: { name: "tool", response: { result: m.content } } }]
            });
        } else {
            geminiContents.push({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }]
            });
        }
    }

    const response = await postJsonWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": auth.key
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemContent }] },
            contents: geminiContents,
            tools: [{ functionDeclarations: toGeminiFunctions(tools) }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } }
        })
    }, "gemini");

    if (!response) return null;
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM Tools] [gemini] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json() as {
        candidates?: Array<{
            content?: {
                parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }>;
            };
        }>;
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const functionCallPart = parts.find(p => p.functionCall);
    const textPart = parts.find(p => typeof p.text === "string");

    if (functionCallPart?.functionCall) {
        const fc = functionCallPart.functionCall;
        return {
            toolName: fc.name,
            toolArgs: fc.args ?? {},
            toolCallId: `gemini-${Date.now()}`,
            finishReason: "tool_calls",
            message: textPart?.text,
        };
    }

    return {
        message: textPart?.text,
        finishReason: "stop",
    };
}

export async function requestToolCompletion(
    auth: LLMAuthConfig,
    messages: AgentMessage[],
    tools: import("./toolDefinitions").ToolDefinition[]
): Promise<ToolCallResponse | null> {
    if (auth.provider === "anthropic") {
        return await callAnthropicWithTools(auth, messages, tools);
    }
    if (auth.provider === "gemini") {
        return await callGeminiWithTools(auth, messages, tools);
    }
    return await callOpenAICompatibleWithTools(auth, messages, tools);
}

export async function requestJsonCompletion(auth: LLMAuthConfig, messages: LLMJsonMessage[]): Promise<string | null> {
    const systemContent = messages.find((message) => message.role === "system")?.content || "";

    if (auth.provider === "anthropic") {
        return await callAnthropic(auth, systemContent, messages);
    }

    if (auth.provider === "gemini") {
        return await callGemini(auth, systemContent, messages);
    }

    return await callOpenAICompatible(auth, messages);
}
