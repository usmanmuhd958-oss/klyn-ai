import { getConfig } from './config.js';

export interface LLMRequest {
  prompt: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  provider?: string;
}

export class LLMGateway {
  private config: any;
  private totalCost: number = 0;
  private totalTokens: number = 0;

  constructor() {
    this.config = getConfig();
  }

  public async execute(request: LLMRequest | string, options?: any): Promise<LLMResponse> {
    const promptText = typeof request === 'string' ? request : request.prompt || '';
    const provider = typeof request === 'object' ? request.provider : options?.provider || 'mock';
    const model = typeof request === 'object' ? request.model : options?.model || 'mock-model';

    this.totalTokens += 370;
    this.totalCost += 0.001;

    return {
      text: `[KLYN AI Mock Output for: "${promptText.slice(0, 50)}..."] Technical architecture & specification processed successfully.`,
      usage: {
        promptTokens: 120,
        completionTokens: 250,
        totalTokens: 370
      },
      model,
      provider
    };
  }

  public async complete(prompt: string, options?: any): Promise<LLMResponse> {
    return this.execute(prompt, options);
  }

  public async chat(messages: any[], options?: any): Promise<LLMResponse> {
    const lastMsg = messages[messages.length - 1]?.content || '';
    return this.execute(lastMsg, options);
  }

  public getCostMetrics(): any {
    return {
      totalCost: this.totalCost,
      totalTokens: this.totalTokens,
      currency: 'USD',
      breakdown: {
        mock: { cost: this.totalCost, tokens: this.totalTokens }
      }
    };
  }

  public getMetrics(): any {
    return this.getCostMetrics();
  }
}

export default LLMGateway;
