/**
 * KLYN AI OS - Agent Swarm
 * Main exports
 */

// @ts-ignore
export { SwarmOrchestrator } from './swarm_orchestrator.ts';
// @ts-ignore
export { ArchitectAgent } from './architect.ts';
// @ts-ignore
export { CoderAgent } from './coder.ts';
// @ts-ignore
export { AuditorAgent } from './auditor.ts';
// @ts-ignore
export { ReviewerAgent } from './reviewer.ts';
// @ts-ignore
export { BaseAgent } from './base_agent.ts';

// @ts-ignore
export { codeGenerationWorkflow, refactoringWorkflow } from './workflows/code_generation.workflow.ts';

export type {
  AgentRole,
  AgentMessage,
  Task,
  TaskType,
  TaskResult,
  AgentCapability,
  Workflow,
  SwarmMetrics,
} from './types.ts';

// Convenience function to create swarm
// @ts-ignore
import { createBrain } from '../1.brain/index.ts';
// @ts-ignore
import { GraphMemory } from '../1.brain/graph_memory.ts';
// @ts-ignore
import { SwarmOrchestrator } from './swarm_orchestrator.ts';

export function createSwarm(dbPath?: string) {
  console.log('🚀 Initializing KLYN AI OS Swarm...\n');
  
  const router = createBrain();
  const memory = new GraphMemory(dbPath);
  // @ts-ignore
  const swarm = new SwarmOrchestrator(router, memory);

  console.log('✅ Swarm ready!\n');

  return { swarm, router, memory };
}
