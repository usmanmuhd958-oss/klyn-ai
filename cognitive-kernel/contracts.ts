export type AgentId = string;

export type Intent = {
  id: string;
  goal: string;
  priority: number;
  context: Record<string, unknown>;
};

export type PlanStep = {
  id: string;
  action: string;
  dependencies: string[];
  expectedOutcome: string;
};

export type Decision = {
  action: string;
  confidence: number;
  reason: string;
};

export interface CognitiveEngine {
  understand(input: string): Promise<Intent>;

  plan(intent: Intent): Promise<PlanStep[]>;

  decide(plan: PlanStep[]): Promise<Decision>;

  reflect(result: unknown): Promise<void>;
}
