/**
 * Google Gemini Provider
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMRequest, LLMResponse, StreamChunk, ProviderConfig } from '../types.ts';
// @ts-ignore
import { MODEL_REGISTRY } from '../config.ts';
import {
  calculateProviderCost,
  createProviderError,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  retryProvider,
} from './provider_utils.ts';

export class GoogleProvider {
  [key: string]: any;
  private client: GoogleGenerativeAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  async generate(request: LLMRequest, modelName: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const model = this.client.getGenerativeModel({ 
        model: modelConfig.apiModelId,
        // @ts-ignore
        systemInstruction: request.systemPrompt,
      });

      const result = await retryProvider(
        'google',
        this.config,
        () => model.generateContent({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            maxOutputTokens: request.maxTokens || DEFAULT_MAX_TOKENS,
            temperature: request.temperature ?? DEFAULT_TEMPERATURE,
            topP: request.topP,
            stopSequences: request.stopSequences,
          },
        }),
      );

      const response = result.response;
      const text = response.text();
      
      // Gemini doesn't always provide token counts
      const usage = {
        // @ts-ignore
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        // @ts-ignore
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        // @ts-ignore
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      };

      const cost = calculateProviderCost(usage, modelConfig);

      return {
        content: text,
        model: modelConfig.modelName,
        provider: 'google',
        usage,
        cost,
        finishReason: 'stop',
        latencyMs: Date.now() - startTime,
      };
    } catch (error: any) {
      throw this.handleError(error, modelName);
    }
  }

  async *stream(request: LLMRequest, modelName: string): AsyncGenerator<StreamChunk> {
    const modelConfig = MODEL_REGISTRY[modelName];
    
    try {
      const model = this.client.getGenerativeModel({ 
        model: modelConfig.apiModelId,
        // @ts-ignore
        systemInstruction: request.systemPrompt,
      });

      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens || DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        },
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        yield {
          delta: text,
          model: modelConfig.modelName,
          isComplete: false,
        };
      }

      yield {
        delta: '',
        model: modelConfig.modelName,
        isComplete: true,
      };
    } catch (error: any) {
      throw this.handleError(error, modelName);
    }
  }

  private handleError(error: any, modelName: string): Error {
    return createProviderError(error, 'google', modelName, 'Google API error');
  }
}
