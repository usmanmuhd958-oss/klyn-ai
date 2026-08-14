export type AgentStatus =
  | "idle" | "planning" | "executing" | "verifying"
  | "blocked" | "done" | "failed";

export interface ReasoningStep {
  id: string;
  ts: number;
  kind: "thought" | "tool-call" | "observation" | "hypothesis";
  text: string;
  tool?: string;
}

export interface SwarmEvent {
  type:
    | "agent:spawn" | "agent:retire" | "agent:status" | "agent:thought"
    | "diff:proposed" | "runtime:metrics" | "workflow:step";
  agentId?: string;
  payload: Record<string, unknown>;
}

export interface AgentManifest {
  id: string;
  role: "planner" | "implementer" | "reviewer" | "healer";
  model: string;
  status: AgentStatus;
  tokensPerSec: number;
  currentTask?: string;
}
