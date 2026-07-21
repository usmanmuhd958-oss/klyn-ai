export interface BrainConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  deepseekApiKey?: string;
  googleApiKey?: string;
  deepseekBaseUrl?: string;
  openaiOrgId?: string;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
};

export const MODEL_REGISTRY: Record<string, any> = {
  anthropic: {
    default: 'claude-fable-5',
    model: 'claude-fable-5',
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
  },
  openai: {
    default: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.01,
  },
  deepseek: {
    default: 'deepseek-v4-pro',
    model: 'deepseek-v4-pro',
    inputCostPer1k: 0.000145,
    outputCostPer1k: 0.00348,
  },
  google: {
    default: 'gemini-3.5-pro',
    model: 'gemini-3.5-pro',
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.005,
  },
  'claude-fable-5': { provider: 'anthropic', inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  'gpt-5.6-sol': { provider: 'openai', inputCostPer1k: 0.0025, outputCostPer1k: 0.01 },
  'deepseek-v4-pro': { provider: 'deepseek', inputCostPer1k: 0.000145, outputCostPer1k: 0.00348 },
  'gemini-3.5-pro': { provider: 'google', inputCostPer1k: 0.00125, outputCostPer1k: 0.005 },
};

export function getConfig(): BrainConfig {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    openaiOrgId: process.env.OPENAI_ORG_ID,
  };
}

export function getProviderConfig(providerName: string): any {
  return MODEL_REGISTRY[providerName] || null;
}

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const config = getConfig();
  const hasAnyKey = Boolean(
    config.anthropicApiKey || config.openaiApiKey || config.deepseekApiKey || config.googleApiKey
  );
  if (!hasAnyKey) {
    errors.push('No API keys configured in .env');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

