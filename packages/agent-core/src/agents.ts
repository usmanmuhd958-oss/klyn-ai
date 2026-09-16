import type { DagTaskNode, AgentRole, AgentTaskContext } from "./contracts.js";

export interface PlannerAgent {
  readonly role: "planner";
  plan(intentId: string): Promise<readonly DagTaskNode[]>;
}

export interface CoderAgent {
  readonly role: "coder";
  executeTask(context: AgentTaskContext, node: DagTaskNode): Promise<void>;
}

export interface ReviewerAgent {
  readonly role: "reviewer";
  review(context: AgentTaskContext, criteria: readonly string[]): Promise<void>;
}

export interface SandboxRunnerAgent {
  readonly role: "sandbox-runner";
  run(context: AgentTaskContext, node: DagTaskNode): Promise<void>;
}

export interface AgentOrchestrationContracts {
  readonly roles: readonly AgentRole[];
}

export const AGENT_ROLES: AgentOrchestrationContracts = Object.freeze({
  roles: ["planner", "coder", "reviewer", "sandbox-runner"] as const,
});
