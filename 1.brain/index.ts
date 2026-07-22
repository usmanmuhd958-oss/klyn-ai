import { validateConfig, getConfig } from './config.js';
import { CognitiveRouter } from './cognitive_router.js';
import { LLMGateway } from './llm_gateway.js';
import { CostOptimizer } from './cost_optimizer.js';
import { GraphMemory } from './graph_memory.js';

export * from './types.js';
// @ts-ignore
export * from './config.js';
export * from './cognitive_router.js';
// @ts-ignore
export * from './llm_gateway.js';
export * from './cost_optimizer.js';
export * from './graph_memory.js';

export function createBrain() {
  const { valid, errors } = validateConfig();
  if (!valid) {
    console.warn('⚠️ Brain Config Warnings:', errors);
  }
  const config = getConfig();
  const gateway = new LLMGateway();
  const optimizer = new CostOptimizer();
  const router = new CognitiveRouter(gateway, optimizer);
  const memory = new GraphMemory();

  return {
    router,
    gateway,
    optimizer,
    memory,
    config,
    getGateway: () => gateway,
    getOptimizer: () => optimizer,
    route: (task: any) => router.route(task),
    routeTask: (task: any) => router.routeTask(task),
    execute: (provider: string, task: any) => router.execute(provider, task)
  };
}

