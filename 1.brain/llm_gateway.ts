/**
 * KLYN AI OS - Unified LLM Gateway
 * Provider-agnostic interface for all LLM interactions
 */

import type { 
  LLMRequest, 
  LLMResponse, 
  StreamChunk, 
  ModelName,
  ProviderError 
} from './types.ts';
import { MODEL_REGISTRY, getProviderConfig, DEFAULT_RETRY_CONFIG } from './config.ts';
import { AnthropicProvider } from './providers/anthropic.provider.ts';
import { OpenAIProvider } from './providers/openai.provider.ts';
import { DeepSeekProvider } from './providers/deepseek.provider.ts';
import { GoogleProvider } from './providers/google.provider.ts';
import { CostOptimizer } from './cost_optimizer.ts';

type Provider = AnthropicProvider | OpenAIProvider | DeepSeekProvider | GoogleProvider;

export class LLMGateway {
  private providers: Map<string, Provider> = new Map();
  private costOptimizer: CostOptimizer;
  private requestCount = 0;

  constructor() {
    this.costOptimizer = new CostOptimizer();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize Anthropic
    const anthropicConfig = getProviderConfig('anthropic');
    if (anthropicConfig.apiKey) {
      this.providers.set('anthropic', new AnthropicProvider(anthropicConfig));
    }

    // Initialize OpenAI
    const openaiConfig = getProviderConfig('openai');
    if (openaiConfig.apiKey) {
      this.providers.set('openai', new OpenAIProvider(openaiConfig));
    }

    // Initialize DeepSeek
    const deepseekConfig = getProviderConfig('deepseek');
    if (deepseekConfig.apiKey) {
      this.providers.set('deepseek', new DeepSeekProvider(deepseekConfig));
    }

    // Initialize Google
    const googleConfig = getProviderConfig('google');
    if (googleConfig.apiKey) {
      this.providers.set('google', new GoogleProvider(googleConfig));
    }
  }

  /**
   * Generate completion with automatic retry and fallback
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    this.requestCount++;
    const requestId = this.requestCount;

    console.log(`[Gateway:${requestId}] Processing request (task: ${request.taskType || 'general'})`);

    // Determine target model
    const targetModel = this.selectModel(request);
    const fallbackChain = request.fallbackChain || this.buildFallbackChain(targetModel);

    console.log(`[Gateway:${requestId}] Selected: ${targetModel}, Fallbacks: [${fallbackChain.join(', ')}]`);

    // Try primary model with retries
    try {
      const response = await this.executeWithRetry(request, targetModel);
      this.recordMetrics(response, request.taskType || 'general');
      console.log(`[Gateway:${requestId}] ✓ Success with ${targetModel} (${response.latencyMs}ms, $${response.cost.totalCost.toFixed(4)})`);
      return response;
    } catch (error) {
      console.warn(`[Gateway:${requestId}] ✗ ${targetModel} failed:`, (error as Error).message);
      
      // Try fallback chain
      for (const fallbackModel of fallbackChain) {
        try {
          console.log(`[Gateway:${requestId}] Attempting fallback: ${fallbackModel}`);
          const response = await this.executeWithRetry(request, fallbackModel);
          this.recordMetrics(response, request.taskType || 'general');
          console.log(`[Gateway:${requestId}] ✓ Fallback success with ${fallbackModel}`);
          return response;
        } catch (fallbackError) {
          console.warn(`[Gateway:${requestId}] ✗ ${fallbackModel} failed:`, (fallbackError as Error).message);
          continue;
        }
      }

      throw new Error(`All models failed for request ${requestId}`);
    }
  }

  /**
   * Stream completion
   */
  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    const targetModel = this.selectModel(request);
    const modelConfig = MODEL_REGISTRY[targetModel];
    const provider = this.providers.get(modelConfig.provider);

    if (!provider) {
      throw new Error(`Provider ${modelConfig.provider} not initialized`);
    }

    yield* provider.stream(request, targetModel);
  }

  /**
   * Execute request with exponential backoff retry
   */
  private async executeWithRetry(
    request: LLMRequest,
    modelName: ModelName
  ): Promise<LLMResponse> {
    const modelConfig = MODEL_REGISTRY[modelName];
    const provider = this.providers.get(modelConfig.provider);

    if (!provider) {
      throw new Error(`Provider ${modelConfig.provider} not initialized`);
    }

    let lastError: Error | null = null;
    let delay = DEFAULT_RETRY_CONFIG.initialDelayMs;

    for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await provider.generate(request, modelName);
      } catch (error) {
        lastError = error as Error;
        const providerError = error as ProviderError;

        if (!providerError.retryable || attempt === DEFAULT_RETRY_CONFIG.maxRetries) {
          throw error;
        }

        console.warn(`[Gateway] Retry ${attempt + 1}/${DEFAULT_RETRY_CONFIG.maxRetries} for ${modelName} after ${delay}ms`);
        await this.sleep(delay);
        delay = Math.min(delay * DEFAULT_RETRY_CONFIG.backoffMultiplier, DEFAULT_RETRY_CONFIG.maxDelayMs);
      }
    }

    throw lastError;
  }

  /**
   * Intelligent model selection
   */
  private selectModel(request: LLMRequest): ModelName {
    // Explicit preference
    if (request.preferredModel && MODEL_REGISTRY[request.preferredModel]) {
      return request.preferredModel;
    }

    // Cost-optimized selection
    if (request.taskType) {
      return this.costOptimizer.recommendModel(request.taskType, request.prompt);
    }

    // Default to cost-effective general model
    return 'deepseek-v4-pro';
  }

  /**
   * Build intelligent fallback chain
   */
  private buildFallbackChain(primary: ModelName): ModelName[] {
    const chain: ModelName[] = [];
    
    // Always include DeepSeek as ultimate fallback (most reliable + cheap)
    const fallbacks: ModelName[] = ['claude-fable-5', 'gpt-5.6-sol', 'deepseek-v4-pro', 'gemini-3.5-pro'];
    
    for (const model of fallbacks) {
      if (model !== primary && MODEL_REGISTRY[model]) {
        chain.push(model);
      }
    }

    return chain.slice(0, 2); // Max 2 fallbacks
  }

  private recordMetrics(response: LLMResponse, taskType: string): void {
    this.costOptimizer.recordUsage(
      response.model,
      taskType as any,
      response.usage.inputTokens,
      response.usage.outputTokens,
      response.cost.totalCost,
      response.latencyMs
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get cost analytics
   */
  getCostMetrics() {
    return this.costOptimizer.getMetrics();
  }

  /**
   * Generate cost report
   */
  generateCostReport(): string {
    return this.costOptimizer.generateReport();
  }

  /**
   * Reset cost tracking
   */
  resetMetrics(): void {
    this.costOptimizer.reset();
  }
}
