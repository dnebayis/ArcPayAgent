export interface LLMAuthConfig {
    provider: string;
    key: string;
    model?: string;
}

export interface LLMJsonMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

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

async function postJsonWithRetry(url: string, init: RequestInit): Promise<Response | null> {
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
            console.error(`[LLM JSON] network error on attempt ${attempt}/${DEFAULT_LLM_HTTP_RETRIES}: ${formatNetworkError(error)}`);
            if (isLastAttempt) {
                return null;
            }
            await sleep(250 * attempt);
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
    });

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
    });

    if (!response) {
        return null;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM JSON] API error ${response.status}: ${errorBody.substring(0, 200)}`);
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
    });

    if (!response) {
        return null;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[LLM JSON] API error ${response.status}: ${errorBody.substring(0, 200)}`);
        return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.find((item: any) => typeof item?.text === "string")?.text || null;
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
