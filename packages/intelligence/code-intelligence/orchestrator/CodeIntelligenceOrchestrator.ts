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
