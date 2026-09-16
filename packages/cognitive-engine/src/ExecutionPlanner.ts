import type { IntentSpec } from "./IntentSpec.js";
import type { CompiledTaskGraph } from "./TaskGraphCompiler.js";

export type AgentRole = "ARCHITECT" | "BUILDER" | "VALIDATOR" | "EVIDENCE";

export interface AgentAllocationRule {
  readonly role: AgentRole;
  readonly taskKinds: readonly ("OBJECTIVE" | "DEPENDENCY" | "CONSTRAINT_CHECK" | "ACCEPTANCE_CHECK" | "EVIDENCE_CHECK")[];
  readonly maxConcurrentTasks: number;
}

export interface ExecutionStrategy {
  readonly intentId: string;
  readonly contentHash: string;
  readonly maxConcurrency: number;
  readonly allocation: readonly AgentAllocationRule[];
  readonly layerConcurrency: readonly number[];
}

export class ExecutionPlanner {
  plan(intent: IntentSpec, graph: CompiledTaskGraph): ExecutionStrategy {
    if (intent.intentId !== graph.intentId || intent.contentHash !== graph.contentHash) {
      throw new Error("Intent and task graph identity mismatch");
    }
    const maxConcurrency = Math.min(intent.resourceBudget.maxConcurrentTasks, graph.resolution.layers.reduce((max, layer) => Math.max(max, layer.length), 0) || 1);
    const allocation: AgentAllocationRule[] = [
      { role: "ARCHITECT", taskKinds: ["OBJECTIVE"], maxConcurrentTasks: 1 },
      { role: "BUILDER", taskKinds: ["DEPENDENCY", "CONSTRAINT_CHECK"], maxConcurrentTasks: maxConcurrency },
      { role: "VALIDATOR", taskKinds: ["ACCEPTANCE_CHECK"], maxConcurrentTasks: maxConcurrency },
      { role: "EVIDENCE", taskKinds: ["EVIDENCE_CHECK"], maxConcurrentTasks: maxConcurrency },
    ];
    const normalized = allocation.map((rule) => Object.freeze({ ...rule, taskKinds: Object.freeze([...rule.taskKinds].sort()) }));
    return Object.freeze({
      intentId: intent.intentId,
      contentHash: intent.contentHash,
      maxConcurrency,
      allocation: Object.freeze(normalized),
      layerConcurrency: Object.freeze(graph.resolution.layers.map((layer) => Math.min(maxConcurrency, layer.length))),
    });
  }
}
