import { providerFetch, requireApiKey } from "./http.js";
export class AnthropicAdapter {
    baseUrl;
    name = "anthropic";
    constructor(baseUrl = "https://api.anthropic.com/v1") {
        this.baseUrl = baseUrl;
    }
    async generate(request) {
        const key = requireApiKey("ANTHROPIC_API_KEY");
        const response = await providerFetch(this.name, `${this.baseUrl}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: request.model, system: request.system, messages: [{ role: "user", content: request.input }], max_tokens: request.maxOutputTokens ?? 4096, temperature: request.temperature }),
        }, request.signal);
        const body = await response.json();
        return { provider: this.name, model: request.model, output: body.content?.filter(x => x.type === "text").map(x => x.text ?? "").join("") ?? "", requestId: body.id, usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
    }
    async *stream(request) {
        const key = requireApiKey("ANTHROPIC_API_KEY");
        const response = await providerFetch(this.name, `${this.baseUrl}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: request.model, system: request.system, messages: [{ role: "user", content: request.input }], max_tokens: request.maxOutputTokens ?? 4096, temperature: request.temperature, stream: true }),
        }, request.signal);
        if (!response.body)
            throw new Error("Anthropic returned no stream body");
        yield* parseAnthropicSSE(response.body, request.model);
    }
}
async function* parseAnthropicSSE(body, model) {
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
                try {
                    const event = JSON.parse(line.slice(5).trim());
                    if (event.delta?.type === "text_delta" && event.delta.text)
                        yield { provider: "anthropic", model, text: event.delta.text };
                    if (event.type === "message_stop")
                        yield { provider: "anthropic", model, text: "", done: true };
                }
                catch { /* malformed frames are ignored */ }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=anthropic.js.map