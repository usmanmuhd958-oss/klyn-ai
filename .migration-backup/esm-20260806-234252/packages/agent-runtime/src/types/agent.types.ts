export type AgentType =
  | "research"
  | "coder"
  | "reviewer"
  | "security"
  | "deployment"
  | "docs"
  | "reasoning"
  | "execution"
  | "planner"
  | "worker";

export interface AgentTask {
  id: string;
  type: AgentType;

  // ✅ FIX: unified input model
  input: string;

  payload?: any;

  priority: number;
}
