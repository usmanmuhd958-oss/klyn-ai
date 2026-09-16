export type IntelligenceStage =
  | "ast"
  | "semantic"
  | "symbol"
  | "graph"
  | "impact"
  | "review"
  | "root-cause";

export interface IntelligenceSignal {
  stage: IntelligenceStage;
  message: string;
  confidence: number;
}

export interface IntelligenceDecision {
  target: string;
  signals: IntelligenceSignal[];
  riskScore: number;
  recommendation: string;
  timestamp: Date;
}
