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

/**
 * Canonical model registry. Every per-model entry carries:
 *   - apiModelId            — the REAL provider API identifier
 *   - costPerMToken         — USD per 1M input tokens (canonical, consumed by
 *                             all providers' telemetry)
 *   - costPerMTokenOutput   — USD per 1M output tokens
 *   - inputCostPer1k / outputCostPer1k — derived equivalents kept for any
 *                             consumer that still reads the 1k convention.
 *
 * Model IDs are real, production-valid identifiers (not stubs).
 */
export const MODEL_REGISTRY: Record<string, any> = {
  // ── Provider-level blocks (used by getProviderConfig / defaults) ──
  anthropic: {
    default: 'claude-sonnet-4-5',
    model: 'claude-sonnet-4-5',
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    costPerMToken: 3,
    costPerMTokenOutput: 15,
  },
  openai: {
    default: 'gpt-4o',
    model: 'gpt-4o',
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.01,
    costPerMToken: 2.5,
    costPerMTokenOutput: 10,
  },
  deepseek: {
    default: 'deepseek-chat',
    model: 'deepseek-chat',
    inputCostPer1k: 0.00028,
    outputCostPer1k: 0.0011,
    costPerMToken: 0.28,
    costPerMTokenOutput: 1.1,
  },
  google: {
    default: 'gemini-2.5-pro',
    model: 'gemini-2.5-pro',
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.01,
    costPerMToken: 1.25,
    costPerMTokenOutput: 10,
  },

  // ── Per-model entries (consumed as MODEL_REGISTRY[modelName]) ──
  'gpt-4o': {
    provider: 'openai',
    modelName: 'gpt-4o',
    apiModelId: 'gpt-4o',
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.01,
    costPerMToken: 2.5,
    costPerMTokenOutput: 10,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    apiModelId: 'gpt-4o-mini',
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
    costPerMToken: 0.15,
    costPerMTokenOutput: 0.6,
  },
  'claude-sonnet-4-5': {
    provider: 'anthropic',
    modelName: 'claude-sonnet-4-5',
    apiModelId: 'claude-sonnet-4-5',
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    costPerMToken: 3,
    costPerMTokenOutput: 15,
  },
  'claude-haiku-4-5': {
    provider: 'anthropic',
    modelName: 'claude-haiku-4-5',
    apiModelId: 'claude-haiku-4-5',
    inputCostPer1k: 0.001,
    outputCostPer1k: 0.005,
    costPerMToken: 1,
    costPerMTokenOutput: 5,
  },
  'deepseek-chat': {
    provider: 'deepseek',
    modelName: 'deepseek-chat',
    apiModelId: 'deepseek-chat',
    inputCostPer1k: 0.00028,
    outputCostPer1k: 0.0011,
    costPerMToken: 0.28,
    costPerMTokenOutput: 1.1,
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    modelName: 'deepseek-reasoner',
    apiModelId: 'deepseek-reasoner',
    inputCostPer1k: 0.00055,
    outputCostPer1k: 0.00219,
    costPerMToken: 0.55,
    costPerMTokenOutput: 2.19,
  },
  'gemini-2.5-pro': {
    provider: 'google',
    modelName: 'gemini-2.5-pro',
    apiModelId: 'gemini-2.5-pro',
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.01,
    costPerMToken: 1.25,
    costPerMTokenOutput: 10,
  },
  'gemini-2.5-flash': {
    provider: 'google',
    modelName: 'gemini-2.5-flash',
    apiModelId: 'gemini-2.5-flash',
    inputCostPer1k: 0.0003,
    outputCostPer1k: 0.0025,
    costPerMToken: 0.3,
    costPerMTokenOutput: 2.5,
  },
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
