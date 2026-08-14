export interface CommandIntent {
  id: string;
  prompt: string;
  timestamp: Date;
  status:
    | "idle"
    | "planning"
    | "executing"
    | "validating"
    | "completed"
    | "failed";
}

export interface AgentAction {
  agentId: string;
  role:
    | "planner"
    | "architect"
    | "coder"
    | "tester"
    | "security";

  action: string;

  status:
    | "waiting"
    | "thinking"
    | "running"
    | "done"
    | "error";
}
