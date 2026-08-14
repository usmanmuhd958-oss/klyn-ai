export type WorkflowPhase =
  | "planning"
  | "executing"
  | "verifying"
  | "recovering"
  | "completed"
  | "failed";

export interface WorkflowTask {
  id: string;
  name: string;
  agent: string;
  phase: WorkflowPhase;
  status: "pending" | "running" | "success" | "failed";
  createdAt: number;
}

export interface ExecutionGraph {
  id: string;
  intent: string;
  tasks: WorkflowTask[];
  phase: WorkflowPhase;
}
