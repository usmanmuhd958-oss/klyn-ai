/**
 * KLYN AI OS - Agent Swarm
 * Main exports
 */

export { SwarmOrchestrator } from './swarm_orchestrator.ts';
export { ArchitectAgent } from './architect.ts';
export { CoderAgent } from './coder.ts';
export { AuditorAgent } from './auditor.ts';
export { ReviewerAgent } from './reviewer.ts';
export { BaseAgent } from './base_agent.ts';

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
import { createBrain } from '../1.brain/index.ts';
import { GraphMemory } from '../1.brain/graph_memory.ts';
import { SwarmOrchestrator } from './swarm_orchestrator.ts';

export function createSwarm(dbPath?: string) {
  console.log('🚀 Initializing KLYN AI OS Swarm...\n');
  
  const router = createBrain();
  const memory = new GraphMemory(dbPath);
  const swarm = new SwarmOrchestrator(router, memory);

  console.log('✅ Swarm ready!\n');

  return { swarm, router, memory };
}
