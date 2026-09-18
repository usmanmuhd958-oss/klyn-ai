import { ProviderError, providerFetch } from "./http.js";
export class OllamaAdapter {
    baseUrl;
    name = "ollama";
    constructor(baseUrl = "http://127.0.0.1:11434") {
        this.baseUrl = baseUrl;
    }
    async generate(request) {
        const body = {
            model: request.model,
            messages: [
                ...(request.system ? [{ role: "system", content: request.system }] : []),
                { role: "user", content: request.input },
            ],
            stream: false,
            ...(request.maxOutputTokens !== undefined || request.temperature !== undefined
                ? {
                    options: {
                        ...(request.maxOutputTokens !== undefined ? { num_predict: request.maxOutputTokens } : {}),
                        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
                    },
                }
                : {}),
            ...(request.responseFormat === "json" ? { format: "json" } : {}),
        };
        const response = await providerFetch(this.name, `${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }, request.signal);
        const data = await response.json();
        return {
            provider: this.name,
            model: request.model,
            output: data.message?.content ?? "",
            usage: {
                inputTokens: data.prompt_eval_count,
                outputTokens: data.eval_count,
            },
        };
    }
    async *stream(request) {
        const response = await providerFetch(this.name, `${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model: request.model,
                messages: [
                    ...(request.system ? [{ role: "system", content: request.system }] : []),
                    { role: "user", content: request.input },
                ],
                stream: true,
                ...(request.maxOutputTokens !== undefined || request.temperature !== undefined
                    ? {
                        options: {
                            ...(request.maxOutputTokens !== undefined ? { num_predict: request.maxOutputTokens } : {}),
                            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
                        },
                    }
                    : {}),
                ...(request.responseFormat === "json" ? { format: "json" } : {}),
            }),
        }, request.signal);
        if (!response.body)
            throw new ProviderError("Ollama returned no streaming body", this.name, true, response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    const event = JSON.parse(trimmed);
                    const text = event.message?.content ?? "";
                    if (text)
                        yield { provider: this.name, model: request.model, text };
                    if (event.done) {
                        yield { provider: this.name, model: request.model, text: "", done: true };
                        return;
                    }
                }
            }
        }
        catch (error) {
            if (error instanceof SyntaxError)
                throw new ProviderError("Ollama returned malformed streaming JSON", this.name, false);
            throw error;
        }
        finally {
            reader.releaseLock();
        }
        yield { provider: this.name, model: request.model, text: "", done: true };
    }
}
//# sourceMappingURL=ollama.js.map