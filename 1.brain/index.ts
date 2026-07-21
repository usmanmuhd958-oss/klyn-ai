/**
 * KLYN AI OS - Brain Layer (Layer 1)
 * Main Export Module
 */

export { LLMGateway } from './llm_gateway.ts';
export { CognitiveRouter } from './cognitive_router.ts';
export { CostOptimizer } from './cost_optimizer.ts';

export type {
  ModelProvider,
  ModelName,
  TaskType,
  LLMRequest,
  LLMResponse,
  StreamChunk,
  Tool,
  ToolCall,
  CostMetrics,
  ModelCapability,
  ProviderError,
} from './types.ts';

export { MODEL_REGISTRY, validateConfig } from './config.ts';

// Convenience export for quick initialization
export function createBrain() {
  const { valid, errors } = validateConfig();
  
  if (!valid) {
    console.error('❌ Brain initialization failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    throw new Error('Missing required API keys');
  }

  console.log('🧠 KLYN AI OS Brain Layer initialized');
  return new CognitiveRouter();
}
