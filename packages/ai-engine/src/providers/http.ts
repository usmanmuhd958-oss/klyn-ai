import type { ProviderRequest } from "./types.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw new ProviderError(
      error instanceof Error ? error.message : "Provider network failure",
      provider,
      true,
    );
  }

  if (response.ok) return response;

  const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  throw new ProviderError(
    `${provider} returned HTTP ${response.status}`,
    provider,
    retryable,
    response.status,
  );
}

export function jsonHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

export function requireApiKey(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected provider`);
  return value;
}

export function buildMessages(request: ProviderRequest): Array<{ role: "system" | "user"; content: string }> {
  return [
    ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
    { role: "user", content: request.input },
  ];
}
