/**
 * LLM Provider Utilities
 */

import type { LLMRequest, ProviderConfig } from '../types.ts';
import { withRetryAndCircuit } from '../../kernel/backoff.js';

export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_TEMPERATURE = 0.7;

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProviderModelCost {
  costPerMToken: number;
  costPerMTokenOutput: number;
}

export function calculateProviderCost(usage: ProviderUsage, modelConfig: ProviderModelCost) {
  const inputCost = (usage.inputTokens / 1_000_000) * modelConfig.costPerMToken;
  const outputCost = (usage.outputTokens / 1_000_000) * modelConfig.costPerMTokenOutput;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

function providerRetryOptions(config: ProviderConfig) {
  return { maxAttempts: config.maxRetries || 3, baseMs: 200, maxMs: 8_000 };
}

export function retryProvider<T>(provider: string, config: ProviderConfig, operation: () => Promise<T>): Promise<T> {
  return withRetryAndCircuit(provider, operation, providerRetryOptions(config));
}

export function createProviderError(error: any, provider: string, modelName: string, defaultMessage: string): Error {
  return {
    name: 'ProviderError',
    message: error.message || defaultMessage,
    provider,
    model: modelName,
    statusCode: error.status,
    retryable: error.status === 429 || error.status >= 500,
  } as any;
}

export function buildOpenAICompatibleMessages(request: LLMRequest, includeImages = true): any[] {
  const messages: any[] = [];
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }
  messages.push({
    role: 'user',
    content: includeImages && request.images?.length
      ? [
          { type: 'text', text: request.prompt },
          ...request.images.map(img => ({
            type: 'image_url',
            image_url: { url: img.startsWith('http') ? img : `data:image/png;base64,${img}` },
          })),
        ]
      : request.prompt,
  });
  return messages;
}
