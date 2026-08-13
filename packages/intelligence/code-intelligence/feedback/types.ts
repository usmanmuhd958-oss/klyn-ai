export interface IntelligenceFeedback {
  id: string;

  decisionId: string;

  outcome:
    | "accepted"
    | "rejected"
    | "fixed"
    | "regression";

  score: number;

  notes?: string;

  timestamp: Date;
}


export interface LearningSignal {
  source: string;

  adjustment: number;

  confidence: number;
}
