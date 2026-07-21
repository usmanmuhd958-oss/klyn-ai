/**
 * KLYN AI OS - Brain Configuration
 * Model Registry & Provider Settings
 */

import type { ModelCapability, ProviderConfig, RetryConfig } from './types.ts';

export const MODEL_REGISTRY: Record<string, ModelCapability> = {
  'claude-fable-5': {
    provider: 'anthropic',
    modelName: 'claude-fable-5',
    apiModelId: 'claude-fable-5-20260315',
    strengths: ['agentic_coding', 'refactoring', 'self_healing', 'general'],
    contextWindow: 400_000,
    costPerMToken: 15.00,      // $15 per 1M input tokens
    costPerMTokenOutput: 75.00, // $75 per 1M output tokens
    requestsPerMinute: 4_000,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'gpt-5.6-sol': {
    provider: 'openai',
    modelName: 'gpt-5.6-sol',
    apiModelId: 'gpt-5.6-sol-20260220',
    strengths: ['architecture', 'code_inspection', 'general'],
    contextWindow: 256_000,
    costPerMToken: 12.00,
    costPerMTokenOutput: 48.00,
    requestsPerMinute: 10_000,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'deepseek-v4-pro': {
    provider: 'deepseek',
    modelName: 'deepseek-v4-pro',
    apiModelId: 'deepseek-chat-v4-pro',
    strengths: ['test_generation', 'log_analysis', 'code_inspection', 'general'],
    contextWindow: 128_000,
    costPerMToken: 0.14,       // Ultra cost-optimized
    costPerMTokenOutput: 0.28,
    requestsPerMinute: 2_000,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'gemini-3.5-pro': {
    provider: 'google',
    modelName: 'gemini-3.5-pro',
    apiModelId: 'gemini-3.5-pro-latest',
    strengths: ['dependency_mapping', 'architecture'],
    contextWindow: 2_000_000,  // 2M context window
    costPerMToken: 1.25,
    costPerMTokenOutput: 5.00,
    requestsPerMinute: 1_500,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
  },
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 32000,
  backoffMultiplier: 2,
};

export const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

export function getProviderConfig(provider: string): ProviderConfig {
  const envPrefix = provider.toUpperCase();
  
  return {
    apiKey: process.env[`${envPrefix}_API_KEY`] || '',
    baseUrl: process.env[`${envPrefix}_BASE_URL`],
    organization: process.env[`${envPrefix}_ORG_ID`],
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_RETRY_CONFIG.maxRetries,
  };
}

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  for (const model of Object.values(MODEL_REGISTRY)) {
    const config = getProviderConfig(model.provider);
    if (!config.apiKey) {
      errors.push(`Missing API key for ${model.provider}: ${model.provider.toUpperCase()}_API_KEY`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
