#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/orchestrator"

mkdir -p "$ROOT"

cat > "$ROOT/types.ts" <<'TS'
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
TS

cat > "$ROOT/CodeIntelligenceOrchestrator.ts" <<'TS'
import {
  IntelligenceDecision,
  IntelligenceSignal
} from "./types.js";

export class CodeIntelligenceOrchestrator {

  analyze(
    target: string,
    signals: IntelligenceSignal[] = []
  ): IntelligenceDecision {

    const riskScore = Math.min(
      signals.reduce(
        (score, signal) =>
          score + Math.round(signal.confidence * 10),
        0
      ),
      100
    );

    const recommendation =
      riskScore >= 70
        ? "HIGH_RISK_REVIEW_REQUIRED"
        : riskScore >= 40
          ? "VALIDATION_RECOMMENDED"
          : "LOW_RISK_CHANGE";

    return {
      target,
      signals,
      riskScore,
      recommendation,
      timestamp: new Date()
    };
  }

}
TS

cat > "$ROOT/index.ts" <<'TS'
export * from "./types.js";
export * from "./CodeIntelligenceOrchestrator.js";
TS

echo "✅ Unified Code Intelligence Orchestrator installed"
