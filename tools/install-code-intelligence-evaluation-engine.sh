#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/evaluation"

mkdir -p "$ROOT"

cat > "$ROOT/types.ts" <<'TS'
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
TS


cat > "$ROOT/EvaluationEngine.ts" <<'TS'
import {
  EvaluationRecord,
  IntelligenceScore
} from "./types.js";


export class EvaluationEngine {

  private records:
    EvaluationRecord[];


  constructor() {

    this.records = [];

  }


  evaluate(
    record: EvaluationRecord
  ): void {

    this.records.push(record);

  }


  score(): IntelligenceScore {

    if (this.records.length === 0) {

      return {
        overall: 0,
        confidence: 0,
        samples: 0
      };

    }


    const total =
      this.records.reduce(
        (sum,item)=>
          sum + item.score,
        0
      );


    const confidence =
      this.records.reduce(
        (sum,item)=>
          sum + item.confidence,
        0
      );


    return {

      overall:
        total / this.records.length,

      confidence:
        confidence / this.records.length,

      samples:
        this.records.length

    };

  }


  snapshot(){

    return this.records;

  }

}
TS


cat > "$ROOT/index.ts" <<'TS'
export * from "./types.js";
export * from "./EvaluationEngine.js";
TS


echo "✅ Code Intelligence Evaluation Engine installed"

