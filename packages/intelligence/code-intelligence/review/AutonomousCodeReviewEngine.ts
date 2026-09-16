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
