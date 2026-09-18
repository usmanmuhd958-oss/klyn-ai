export type ProviderName = "openai" | "anthropic" | "gemini" | "deepseek" | "openrouter" | "groq" | "together" | "fireworks" | "replicate" | "mistral" | "cohere" | "ollama" | "vllm" | "lmstudio" | "custom";

export interface ProviderRequest {
  model: string;
  system?: string;
  input: string;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  responseFormat?: "text" | "json";
}

export interface ProviderUsage { inputTokens?: number; outputTokens?: number; }

export interface ProviderResponse {
  provider: ProviderName;
  model: string;
  output: string;
  usage?: ProviderUsage;
  requestId?: string;
}

export interface StreamChunk {
  provider: ProviderName;
  model: string;
  text: string;
  done?: boolean;
  usage?: ProviderUsage;
  requestId?: string;
}

export interface ProviderAdapter {
  readonly name: ProviderName;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  stream(request: ProviderRequest): AsyncIterable<StreamChunk>;
}
