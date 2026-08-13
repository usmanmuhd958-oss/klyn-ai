export interface EvaluationRecord {

  id: string;

  component:
    | "ast"
    | "semantic"
    | "graph"
    | "impact"
    | "review";

  score: number;

  confidence: number;

  success: boolean;

  timestamp: Date;
}


export interface IntelligenceScore {

  overall: number;

  confidence: number;

  samples: number;

}
