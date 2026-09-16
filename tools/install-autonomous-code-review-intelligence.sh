#!/data/data/com.termux/files/usr/bin/bash

set -e

ROOT="packages/intelligence/code-intelligence/review"

mkdir -p "$ROOT"

cat > "$ROOT/ReviewFinding.ts" <<'TS'
export type ReviewSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low";

export interface ReviewFinding {
  id: string;
  title: string;
  description: string;
  severity: ReviewSeverity;
  file: string;
  suggestion?: string;
}
TS


cat > "$ROOT/AutonomousCodeReviewEngine.ts" <<'TS'
import { ReviewFinding } from "./ReviewFinding.js";

export class AutonomousCodeReviewEngine {

  review(
    files: string[]
  ): ReviewFinding[] {

    const findings: ReviewFinding[] = [];

    for (const file of files) {

      if (file.includes("auth")) {
        findings.push({
          id: crypto.randomUUID(),
          title: "Authentication change detected",
          description:
            "Authentication related code requires deeper validation.",
          severity: "high",
          file,
          suggestion:
            "Run security and integration tests."
        });
      }

    }

    return findings;
  }

}
TS


cat > "$ROOT/index.ts" <<'TS'
export * from "./ReviewFinding.js";
export * from "./AutonomousCodeReviewEngine.js";
TS


echo "✅ Autonomous Code Review Intelligence installed"
