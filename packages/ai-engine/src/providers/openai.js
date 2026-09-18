import { buildMessages, jsonHeaders, providerFetch, requireApiKey } from "./http.js";
function textFromResponse(body) {
    const value = body;
    return value.choices?.[0]?.message?.content ?? "";
}
export class OpenAIAdapter {
    baseUrl;
    name = "openai";
    constructor(baseUrl = "https://api.openai.com/v1") {
        this.baseUrl = baseUrl;
    }
    async generate(request) {
        const key = requireApiKey("OPENAI_API_KEY");
        const response = await providerFetch(this.name, `${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: jsonHeaders(key),
            body: JSON.stringify({
                model: request.model,
                messages: buildMessages(request),
                max_tokens: request.maxOutputTokens,
                temperature: request.temperature,
                ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
            }),
        }, request.signal);
        const body = await response.json();
        const raw = body;
        return {
            provider: this.name,
            model: request.model,
            output: textFromResponse(body),
            requestId: raw.id,
            usage: { inputTokens: raw.usage?.prompt_tokens, outputTokens: raw.usage?.completion_tokens },
        };
    }
    async *stream(request) {
        const key = requireApiKey("OPENAI_API_KEY");
        const response = await providerFetch(this.name, `${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: jsonHeaders(key),
            body: JSON.stringify({
                model: request.model,
                messages: buildMessages(request),
                max_tokens: request.maxOutputTokens,
                temperature: request.temperature,
                stream: true,
            }),
        }, request.signal);
        if (!response.body)
            throw new Error("OpenAI returned no stream body");
        yield* parseSSE(response.body, this.name, request.model);
    }
}
async function* parseSSE(body, provider, model) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("data:"))
                    continue;
                const data = line.slice(5).trim();
                if (data === "[DONE]") {
                    yield { provider, model, text: "", done: true };
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    const text = json.choices?.[0]?.delta?.content ?? "";
                    if (text)
                        yield { provider, model, text };
                }
                catch { /* ignore incomplete/non-JSON SSE frames */ }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=openai.js.map