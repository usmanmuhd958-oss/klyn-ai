import { ControlPlaneError } from "./errors.js";
import type { AnomalyEvidence, AnomalyVector, BreakerLevel } from "./types.js";

const DIMENSIONS: (keyof AnomalyVector)[] = [
  "identity", "capability", "resource", "temporal", "state", "sequence", "artifact", "infrastructure",
];

const WEIGHTS: Record<keyof AnomalyVector, number> = {
  identity: 1.6,
  capability: 2.0,
  resource: 1.4,
  temporal: 0.8,
  state: 2.0,
  sequence: 1.2,
  artifact: 1.6,
  infrastructure: 1.0,
};

function validateVector(vector: AnomalyVector): void {
  for (const dimension of DIMENSIONS) {
    const value = vector[dimension];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new ControlPlaneError("ANOMALY_DETECTED", `INVALID_ANOMALY_VECTOR:${dimension}`);
    }
  }
}

function distance(a: AnomalyVector, b: AnomalyVector): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const dimension of DIMENSIONS) {
    weighted += Math.abs(a[dimension] - b[dimension]) * WEIGHTS[dimension];
    totalWeight += WEIGHTS[dimension];
  }
  return weighted / totalWeight;
}

export interface AnomalyInput {
  readonly expected: AnomalyVector;
  readonly observed: AnomalyVector;
  readonly systemBaseline: AnomalyVector;
  readonly hardViolations?: readonly string[];
}

export class AnomalyEngine {
  evaluate(input: AnomalyInput): AnomalyEvidence {
    validateVector(input.expected);
    validateVector(input.observed);
    validateVector(input.systemBaseline);

    const behavioralDistance = distance(input.expected, input.observed);
    const systemDriftDistance = distance(input.systemBaseline, input.observed);
    const hardViolations = Object.freeze([...(input.hardViolations ?? [])]);

    let breakerLevel: BreakerLevel = "NONE";
    if (hardViolations.length > 0 || behavioralDistance >= 0.75 || systemDriftDistance >= 0.85) {
      breakerLevel = "MISSION_HALT";
    } else if (behavioralDistance >= 0.45 || systemDriftDistance >= 0.60) {
      breakerLevel = "EXECUTION_HALT";
    } else if (behavioralDistance >= 0.20 || systemDriftDistance >= 0.35) {
      breakerLevel = "SOFT_HALT";
    }

    return Object.freeze({
      hardViolations,
      behavioralDistance,
      systemDriftDistance,
      breakerLevel,
    });
  }
}
