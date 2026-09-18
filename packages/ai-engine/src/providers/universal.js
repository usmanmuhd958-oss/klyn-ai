import { ProviderError, buildMessages, providerFetch, requireApiKey } from "./http.js";
export class UniversalChatAdapter {
    name;
    config;
    constructor(config) { this.name = config.name; this.config = { ...config, baseUrl: config.baseUrl.replace(/\/$/, "") }; }
    async generate(request) {
        const body = { model: request.model, messages: buildMessages(request), ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}), ...this.config.extraBody };
        const response = await providerFetch(this.name, `${this.config.baseUrl}/chat/completions`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }, request.signal);
        const data = await response.json();
        return { provider: this.name, model: request.model, output: data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "", requestId: data.id, usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens } };
    }
    async *stream(request) {
        const body = { model: request.model, messages: buildMessages(request), stream: true, ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}), ...this.config.extraBody };
        const response = await providerFetch(this.name, `${this.config.baseUrl}/chat/completions`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }, request.signal);
        if (!response.body)
            throw new ProviderError("Provider returned no streaming body", this.name, true, response.status);
        yield* parseOpenAIStream(response.body, this.name, request.model);
    }
    headers() {
        const headers = { "content-type": "application/json", ...this.config.defaultHeaders };
        if (this.config.apiKeyEnv)
            headers.authorization = `Bearer ${requireApiKey(this.config.apiKeyEnv)}`;
        return headers;
    }
}
async function* parseOpenAIStream(body, provider, model) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const event of events) {
                const line = event.split("\n").find((item) => item.startsWith("data:"));
                if (!line)
                    continue;
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") {
                    yield { provider, model, text: "", done: true };
                    return;
                }
                try {
                    const data = JSON.parse(payload);
                    const text = data.choices?.[0]?.delta?.content ?? "";
                    if (text)
                        yield { provider, model, text };
                }
                catch { /* ignore non-JSON keep-alive frames */ }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
    yield { provider, model, text: "", done: true };
}
export function createUniversalAdapter(config) { return new UniversalChatAdapter(config); }
//# sourceMappingURL=universal.js.map