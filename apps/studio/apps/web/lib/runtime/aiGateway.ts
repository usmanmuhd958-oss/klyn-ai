"use client";

export type AIProvider = "openrouter" | "openai" | "anthropic" | "gemini";

export interface GenerationRequest {
  provider: AIProvider;
  role: string;
  prompt: string;
  context?: unknown;
}

export interface GenerationResponse {
  content: string;
  model: string;
  tokens?: number;
}

const DEFAULT_ENDPOINT = "/api/ai/generate";

export async function generateWithAI(
  request: GenerationRequest
): Promise<GenerationResponse> {
  const response = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error("AI Gateway request failed");
  }

  return response.json();
}
