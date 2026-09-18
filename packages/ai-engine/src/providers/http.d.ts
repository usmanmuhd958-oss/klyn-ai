import type { ProviderRequest } from "./types.js";
export declare class ProviderError extends Error {
    readonly provider: string;
    readonly retryable: boolean;
    readonly status?: number | undefined;
    constructor(message: string, provider: string, retryable: boolean, status?: number | undefined);
}
export declare function providerFetch(provider: string, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response>;
export declare function jsonHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string>;
export declare function requireApiKey(name: string): string;
export declare function buildMessages(request: ProviderRequest): Array<{
    role: "system" | "user";
    content: string;
}>;
//# sourceMappingURL=http.d.ts.map