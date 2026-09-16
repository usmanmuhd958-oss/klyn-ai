export type AgentRole = "planner" | "coder" | "reviewer" | "sandbox-runner";

export interface AgentTaskContext {
  readonly runId: string;
  readonly agentId: string;
  readonly intentId: string;
  readonly role: AgentRole;
}

export interface DagTaskNode {
  readonly id: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly dependsOn: readonly string[];
  readonly readPaths: readonly string[];
  readonly writePaths: readonly string[];
  readonly maxRetries?: number;
  readonly run: (context: AgentTaskContext, attempt: number) => Promise<void>;
}

export type DagTaskStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";

export interface DagTaskState {
  readonly id: string;
  readonly status: DagTaskStatus;
  readonly attempts: number;
  readonly error?: string;
}

export interface DagRunResult {
  readonly states: readonly DagTaskState[];
  readonly completed: boolean;
}

export interface StaleRevisionReplanContext {
  readonly runId: string;
  readonly node: DagTaskNode;
  readonly attempt: number;
  readonly error: Error;
}

export type StaleRevisionReplanner = (context: StaleRevisionReplanContext) => Promise<void>;

export interface AgentTrajectoryStep {
  readonly stepId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly intentId: string;
  readonly auditSequence: number;
  readonly auditHash: string;
  readonly requestHash: string;
  readonly resultHash: string;
}

export interface ContextAnchor {
  readonly kind: "symbol" | "range" | "semantic";
  readonly label: string;
  readonly start?: number;
  readonly end?: number;
}

export interface ContextLedgerEntry {
  readonly sequence: number;
  readonly kind: "intent" | "tool-result" | "observation" | "decision";
  readonly sourceId: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly anchors: readonly ContextAnchor[];
  readonly auditHash: string | null;
}

export interface ContextWindow {
  readonly entries: readonly ContextLedgerEntry[];
  readonly serialized: string;
  readonly omittedEntries: number;
}
