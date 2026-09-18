import { providerFetch, requireApiKey } from "./http.js";
export class GeminiAdapter {
    baseUrl;
    name = "gemini";
    constructor(baseUrl = "https://generativelanguage.googleapis.com/v1beta") {
        this.baseUrl = baseUrl;
    }
    async generate(request) {
        const key = requireApiKey("GEMINI_API_KEY");
        const response = await providerFetch(this.name, `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${request.system ? `${request.system}\n\n` : ""}${request.input}` }] }], generationConfig: { maxOutputTokens: request.maxOutputTokens, temperature: request.temperature, ...(request.responseFormat === "json" ? { responseMimeType: "application/json" } : {}) } }),
        }, request.signal);
        const body = await response.json();
        return { provider: this.name, model: request.model, output: body.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "", usage: { inputTokens: body.usageMetadata?.promptTokenCount, outputTokens: body.usageMetadata?.candidatesTokenCount } };
    }
    async *stream(request) {
        const key = requireApiKey("GEMINI_API_KEY");
        const response = await providerFetch(this.name, `${this.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${request.system ? `${request.system}\n\n` : ""}${request.input}` }] }], generationConfig: { maxOutputTokens: request.maxOutputTokens, temperature: request.temperature } }),
        }, request.signal);
        if (!response.body)
            throw new Error("Gemini returned no stream body");
        const reader = response.body.getReader();
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
                        const body = JSON.parse(line.slice(5).trim());
                        const text = body.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
                        if (text)
                            yield { provider: this.name, model: request.model, text };
                    }
                    catch { /* ignore malformed SSE frames */ }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
        yield { provider: this.name, model: request.model, text: "", done: true };
    }
}
//# sourceMappingURL=gemini.js.map