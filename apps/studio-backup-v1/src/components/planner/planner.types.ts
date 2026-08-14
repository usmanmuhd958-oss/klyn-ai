export type PlanningStatus =
  | "pending"
  | "analyzing"
  | "assigned"
  | "executing"
  | "completed"
  | "failed";

export type AgentRole =
  | "planner"
  | "architect"
  | "coder"
  | "tester"
  | "security"
  | "deployment";

export interface PlanningTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  assignedAgent?: AgentRole;
  status: PlanningStatus;
  risk: number;
}

export interface ExecutionGraph {
  id: string;
  intent: string;
  tasks: PlanningTask[];
  createdAt: number;
}
