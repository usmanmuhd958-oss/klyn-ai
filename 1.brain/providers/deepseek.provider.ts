/**
 * DeepSeek V4 Provider (OpenAI-Compatible API)
 */

import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, StreamChunk, ProviderConfig } from '../types.ts';
// @ts-ignore
import { MODEL_REGISTRY } from '../config.ts';

export class DeepSeekProvider {
  [key: string]: any;
  // @ts-ignore
  private client: OpenAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.deepseek.com/v1',
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 120_000,
    });
  }

  async generate(request: LLMRequest, modelName: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const messages: any[] = [];
      
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const response = await this.client.chat.completions.create({
        model: modelConfig.apiModelId,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP,
        stop: request.stopSequences,
      });

      const choice = response.choices[0];
      const usage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      const cost = {
        inputCost: (usage.inputTokens / 1_000_000) * modelConfig.costPerMToken,
        outputCost: (usage.outputTokens / 1_000_000) * modelConfig.costPerMTokenOutput,
        totalCost: 0,
      };
      cost.totalCost = cost.inputCost + cost.outputCost;

      return {
        content: choice.message.content || '',
        model: modelConfig.modelName,
        provider: 'deepseek',
        usage,
        cost,
        finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason as any,
        latencyMs: Date.now() - startTime,
      };
    } catch (error: any) {
      throw this.handleError(error, modelName);
    }
  }

  async *stream(request: LLMRequest, modelName: string): AsyncGenerator<StreamChunk> {
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const messages: any[] = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const stream = await this.client.chat.completions.create({
        model: modelConfig.apiModelId,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        const isComplete = chunk.choices[0]?.finish_reason !== null;

        yield {
          delta,
          model: modelConfig.modelName,
          isComplete,
        };
      }
    } catch (error: any) {
      throw this.handleError(error, modelName);
    }
  }

  private handleError(error: any, modelName: string): Error {
    const isRetryable = error.status === 429 || error.status >= 500;
    
    return {
      name: 'ProviderError',
      message: error.message || 'DeepSeek API error',
      provider: 'deepseek',
      model: modelName,
      statusCode: error.status,
      retryable: isRetryable,
    } as any;
  }
}
