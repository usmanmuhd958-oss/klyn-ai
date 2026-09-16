export interface CognitiveTask {
  id: string;
  goal: string;
  context?: Record<string, unknown>;
}

export interface ReasoningResult {
  decision: string;
  confidence: number;
  reasoning: string[];
}

export interface VerificationResult {
  passed: boolean;
  issues: string[];
}
