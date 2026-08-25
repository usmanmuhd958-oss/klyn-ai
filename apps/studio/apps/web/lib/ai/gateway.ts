import { selectModel } from "./modelSelector";
import { tokenTracker } from "./tokenTracker";

export interface AIRequest {
  workspaceId: string;
  userId: string;
  prompt: string;
  taskType: "code_generation" | "analysis" | "debug" | "architecture";
  maxTokens?: number;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

interface ProviderResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export class AIGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIGatewayError";
  }
}

async function callProvider(
  provider: string,
  model: string,
  request: AIRequest
): Promise<ProviderResponse> {
  try {
    switch (provider) {
      case "openai": {
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "user",
                  content: request.prompt,
                },
              ],
              max_tokens: request.maxTokens ?? 2048,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("OpenAI request failed");
        }

        const data = await response.json();

        return {
          content: data.choices[0].message.content,
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        };
      }

      case "anthropic": {
        throw new Error("Anthropic adapter not configured");
      }

      default:
        throw new Error(`Unsupported provider ${provider}`);
    }
  } catch (error) {
    throw new AIGatewayError(
      error instanceof Error ? error.message : "AI provider failure"
    );
  }
}

/**
 * Main Klyn AI execution gateway.
 */
export async function executeAI(request: AIRequest): Promise<AIResponse> {
  const modelConfig = selectModel(request.taskType);

  const result = await callProvider(
    modelConfig.provider,
    modelConfig.model,
    request
  );

  await tokenTracker.record({
    workspaceId: request.workspaceId,
    userId: request.userId,
    model: modelConfig.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  return {
    content: result.content,
    model: modelConfig.model,
    provider: modelConfig.provider,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  };
}
