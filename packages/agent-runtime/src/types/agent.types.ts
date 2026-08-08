export type AgentType =
  | "planner"
  | "executor"
  | "research"
  | "reviewer"
  | "security"
  | "deployment"
  | "docs"
  | "coder"
  | "system";

export interface AgentTask {
  id?: string;
  type?: AgentType;
  input?: string;
  context?: Record<string, unknown>;
}

export interface AgentContext {
  id?: string;
  name?: string;
  input?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentResult {
  success: boolean;
  output?: unknown;
  error?: string;
}
