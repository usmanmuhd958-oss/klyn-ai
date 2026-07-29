// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * Anthropic Claude Provider
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMRequest, LLMResponse, StreamChunk, ProviderConfig } from '../types.ts';
// @ts-ignore
import { MODEL_REGISTRY } from '../config.ts';

export class AnthropicProvider {
  [key: string]: any;
  private client: Anthropic;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 120_000,
    });
  }

  async generate(request: LLMRequest, modelName: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const response = await this.client.messages.create({
        model: modelConfig.apiModelId,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP,
        stop_sequences: request.stopSequences,
        system: request.systemPrompt,
        messages: [
          {
            role: 'user',
            content: request.images?.length 
              ? [
                  { type: 'text', text: request.prompt },
                  ...request.images.map(img => ({
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: 'image/png' as const,
                      data: img,
                    },
                  })),
                ]
              : request.prompt,
          },
        ],
        tools: request.tools as any,
      });

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      };

      const cost = {
        inputCost: (usage.inputTokens / 1_000_000) * modelConfig.costPerMToken,
        outputCost: (usage.outputTokens / 1_000_000) * modelConfig.costPerMTokenOutput,
        totalCost: 0,
      };
      cost.totalCost = cost.inputCost + cost.outputCost;

      return {
        content: response.content.map((c) => c.type === 'text' ? c.text : '').join(''),
        model: modelConfig.modelName,
        provider: 'anthropic',
        usage,
        cost,
        finishReason: response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason as any,
        toolCalls: response.content
          .filter((c) => c.type === 'tool_use')
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            arguments: c.input,
          })),
        latencyMs: Date.now() - startTime,
      };
    } catch (error: any) {
      throw this.handleError(error, modelName);
    }
  }

  async *stream(request: LLMRequest, modelName: string): AsyncGenerator<StreamChunk> {
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const stream = await this.client.messages.create({
        model: modelConfig.apiModelId,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        messages: [{ role: 'user', content: request.prompt }],
        system: request.systemPrompt,
        stream: true,
      });

      for await (const event of stream) {
        if ((event as any).type === 'content_block_delta' && (event as any).delta.type === 'text_delta') {
          yield {
            delta: (event as any).delta.text,
            model: modelConfig.modelName,
            isComplete: false,
          };
        } else if ((event as any).type === 'message_stop') {
          yield {
            delta: '',
            model: modelConfig.modelName,
            isComplete: true,
          };
        }
      }
    } catch (error: any) {
      throw this.handleError(error, modelName);
    }
  }

  private handleError(error: any, modelName: string): Error {
    const isRetryable = error.status === 429 || error.status >= 500;
    
    return {
      name: 'ProviderError',
      message: error.message || 'Anthropic API error',
      provider: 'anthropic',
      model: modelName,
      statusCode: error.status,
      retryable: isRetryable,
    } as any;
  }
}
