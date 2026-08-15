import { validateConfig, getConfig } from './config.js';
import { CognitiveRouter } from './cognitive_router.js';
import { LLMGateway } from './llm_gateway.js';
import { CostOptimizer } from './cost_optimizer.js';
import { GraphMemory } from './graph_memory.js';

export * from './types.js';
// @ts-ignore
export * from './config.js';
export * from './cognitive_router.js';
// Phase 4: real-time profiling + intent-to-AST synthesis.
export * from './runtime_profiler.js';
export * from './spec_compiler.js';
// Phase 5: cross-repo impact graph + multi-model cascade routing.
export * from './cross_repo_graph.js';
export * from './cascade_router.js';
// Phase 6: autonomous red-team adversarial fuzzing.
export * from './red_team_fuzzer.js';
// Phase 7: autonomous self-evolving intelligence layer.
export * from './experience_learner.js';
export * from './adaptive_policy.js';
export * from './evolution_loop.js';
// Phase 8: headless graph query engine + enterprise knowledge core.
export * from './graph_query_engine.js';
export * from './enterprise_knowledge_graph.js';
// Phase 11: temporal causality engine + autonomous self-replication.
export * from './temporal_causality.js';
export * from './self_replication.js';
// Phase 12: lock-free BFT consensus isolation.
export * from './consensus_isolation.js';
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

