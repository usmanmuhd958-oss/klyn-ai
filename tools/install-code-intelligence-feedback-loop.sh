#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/feedback"

mkdir -p "$ROOT"

cat > "$ROOT/types.ts" <<'TS'
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
TS


cat > "$ROOT/FeedbackEngine.ts" <<'TS'
import {
  IntelligenceFeedback,
  LearningSignal
} from "./types.js";


export class FeedbackEngine {

  private feedback:
    IntelligenceFeedback[];


  constructor() {
    this.feedback = [];
  }


  record(
    item: IntelligenceFeedback
  ): void {

    this.feedback.push(item);

  }


  generateSignal(
    decisionId: string
  ): LearningSignal {

    const items =
      this.feedback.filter(
        item =>
          item.decisionId === decisionId
      );


    const average =
      items.length > 0
        ? items.reduce(
            (sum,item)=>
              sum + item.score,
            0
          ) / items.length
        : 0;


    return {
      source:
        "feedback-engine",

      adjustment:
        average,

      confidence:
        items.length > 0
          ? 0.8
          : 0
    };

  }


  snapshot(){

    return this.feedback;

  }

}
TS


cat > "$ROOT/index.ts" <<'TS'
export * from "./types.js";
export * from "./FeedbackEngine.js";
TS


echo "✅ Code Intelligence Feedback Loop installed"

