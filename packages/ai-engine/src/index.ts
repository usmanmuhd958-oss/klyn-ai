export type AIProvider = "openai" | "anthropic" | "gemini";

export interface ModelRequest {
  provider: AIProvider;
  model: string;
  input: string;
  maxOutputTokens?: number;
}

export interface ModelResponse {
  provider: AIProvider;
  model: string;
  output: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AIEngine {
  generate(request: ModelRequest): Promise<ModelResponse>;
}
