import OpenAI from "openai";

export type AIProvider = "openai" | "anthropic" | "gemini" | "deepseek";

export interface AIRequest {
  provider: AIProvider;
  model: string;
  prompt: string;
  userId: string;
  organizationId: string;
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  cost: number;
  latency: number;
}

export class AIEngine {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  async execute(req: AIRequest): Promise<AIResponse> {
    const start = Date.now();

    try {
      switch (req.provider) {
        case "openai":
          return await this.openaiChat(req, start);

        default:
          throw new Error(`Provider ${req.provider} not implemented`);
      }
    } catch (err: any) {
      return this.fallback(req, start, err.message);
    }
  }

  private async openaiChat(req: AIRequest, start: number): Promise<AIResponse> {
    const result = await this.openai.chat.completions.create({
      model: req.model,
      messages: [{ role: "user", content: req.prompt }]
    });

    const text = result.choices[0]?.message?.content || "";

    return {
      text,
      provider: "openai",
      cost: this.calculateCost(req.model, text),
      latency: Date.now() - start
    };
  }

  private async fallback(req: AIRequest, start: number, error: string): Promise<AIResponse> {
    return {
      text: `Fallback triggered: ${error}`,
      provider: req.provider,
      cost: 0,
      latency: Date.now() - start
    };
  }

  private calculateCost(model: string, output: string): number {
    const tokens = output.length / 4;
    return tokens * 0.00002;
  }
        }
