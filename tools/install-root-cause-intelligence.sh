#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/root-cause"

mkdir -p "$ROOT"

cat > "$ROOT/types.ts" <<'TS'
export interface RootCauseEvidence {
  source: string;
  description: string;
  confidence: number;
}

export interface RootCauseReport {
  incidentId: string;
  probableCause: string;
  confidence: number;
  evidence: RootCauseEvidence[];
  recommendations: string[];
}
TS


cat > "$ROOT/RootCauseEngine.ts" <<'TS'
import {
  RootCauseReport,
  RootCauseEvidence
} from "./types.js";

export class RootCauseEngine {

  analyze(
    incidentId: string,
    symptoms: string[]
  ): RootCauseReport {

    const evidence: RootCauseEvidence[] =
      symptoms.map((item) => ({
        source: "runtime-analysis",
        description: item,
        confidence: 0.5
      }));

    return {
      incidentId,
      probableCause:
        symptoms.length > 0
          ? symptoms[0]
          : "Unknown",

      confidence:
        symptoms.length > 0
          ? 0.5
          : 0,

      evidence,

      recommendations: [
        "Inspect affected dependency chain",
        "Review recent code changes",
        "Execute targeted validation tests"
      ]
    };

  }

}
TS


cat > "$ROOT/index.ts" <<'TS'
export * from "./types.js";
export * from "./RootCauseEngine.js";
TS


echo "✅ Root Cause Intelligence installed"
