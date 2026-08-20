/**
 * DeepSeek V4 Provider (OpenAI-Compatible API)
 */

import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, StreamChunk, ProviderConfig } from '../types.ts';
// @ts-ignore
import { MODEL_REGISTRY } from '../config.ts';
import {
  buildOpenAICompatibleMessages,
  calculateProviderCost,
  createProviderError,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  retryProvider,
} from './provider_utils.ts';

export class DeepSeekProvider {
  [key: string]: any;
  // @ts-ignore
  private client: OpenAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    // SDK auto-retry is disabled — kernel/backoff.ts owns retries (jittered
    // exponential backoff + circuit breaker) so behavior is uniform across
    // providers and 4xx errors never burn quota.
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.deepseek.com/v1',
      maxRetries: 0,
      timeout: config.timeout || 120_000,
    });
  }

  async generate(request: LLMRequest, modelName: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const messages = buildOpenAICompatibleMessages(request, false);

      const response = await retryProvider(
        'deepseek',
        this.config,
        () => this.client.chat.completions.create({
          model: modelConfig.apiModelId,
          messages,
          max_tokens: request.maxTokens || DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          top_p: request.topP,
          stop: request.stopSequences,
        }),
      );

      const choice = response.choices[0];
      const usage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      const cost = calculateProviderCost(usage, modelConfig);

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
      const messages = buildOpenAICompatibleMessages(request, false);

      const stream = await this.client.chat.completions.create({
        model: modelConfig.apiModelId,
        messages,
        max_tokens: request.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
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
    return createProviderError(error, 'deepseek', modelName, 'DeepSeek API error');
  }
}
