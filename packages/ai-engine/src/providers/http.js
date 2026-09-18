export class ProviderError extends Error {
    provider;
    retryable;
    status;
    constructor(message, provider, retryable, status) {
        super(message);
        this.provider = provider;
        this.retryable = retryable;
        this.status = status;
        this.name = "ProviderError";
    }
}
export async function providerFetch(provider, url, init, signal) {
    let response;
    try {
        response = await fetch(url, { ...init, signal });
    }
    catch {
        throw new ProviderError("Provider network failure", provider, true);
    }
    if (response.ok)
        return response;
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    throw new ProviderError(`${provider} returned HTTP ${response.status}`, provider, retryable, response.status);
}
export function jsonHeaders(apiKey, extra = {}) {
    return {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...extra,
    };
}
export function requireApiKey(name) {
    const value = process.env[name]?.trim();
    if (!value)
        throw new Error(`${name} is required for the selected provider`);
    return value;
}
export function buildMessages(request) {
    return [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        { role: "user", content: request.input },
    ];
}
//# sourceMappingURL=http.js.map