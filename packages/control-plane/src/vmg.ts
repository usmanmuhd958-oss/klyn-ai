import { ControlPlaneError } from "./errors.js";
import { type MissionState, type MissionRecord, type TransitionContext } from "./types.js";

const VALID: Readonly<Record<MissionState, readonly MissionState[]>> = Object.freeze({
  INTENT_CAPTURED: ["ENVELOPE_DEFINED"],
  ENVELOPE_DEFINED: ["PLAN_GENERATED"],
  PLAN_GENERATED: ["ACTION_EXECUTED"],
  ACTION_EXECUTED: ["ARTIFACT_PRODUCED"],
  ARTIFACT_PRODUCED: ["AUTOMATED_VERIFICATION"],
  AUTOMATED_VERIFICATION: ["HUMAN_APPROVAL"],
  HUMAN_APPROVAL: ["PRODUCTION_ROLLOUT_AUDITED"],
  PRODUCTION_ROLLOUT_AUDITED: [],
});

export interface TransitionDecision {
  readonly from: MissionState;
  readonly to: MissionState;
  readonly nextVersion: bigint;
}

export class VMGEngine {
  transition(mission: MissionRecord, to: MissionState, expectedVersion: bigint, context: TransitionContext): TransitionDecision {
    if (mission.version !== expectedVersion) throw new ControlPlaneError("STATE_CONFLICT", `VERSION_CONFLICT:${expectedVersion.toString()}:${mission.version.toString()}`);
    if (mission.breakerLevel !== "NONE" || context.breakerLevel !== "NONE") throw new ControlPlaneError("BREAKER_ACTIVE", "CIRCUIT_BREAKER_BLOCKS_STATE_TRANSITION");
    if (!VALID[mission.state].includes(to)) throw new ControlPlaneError("INVALID_TRANSITION", `${mission.state}->${to}`);

    switch (to) {
      case "ENVELOPE_DEFINED":
        requireGuard(context.envelopeValid, "VALID_ENVELOPE_REQUIRED");
        break;
      case "PLAN_GENERATED":
        requireGuard(context.planAuthorized, "AUTHORIZED_PLAN_REQUIRED");
        break;
      case "ACTION_EXECUTED":
        requireGuard(context.executionSucceeded, "SUCCESSFUL_EXECUTION_REQUIRED");
        break;
      case "ARTIFACT_PRODUCED":
        requireGuard(context.artifactProvenanceValid, "VERIFIED_ARTIFACT_PROVENANCE_REQUIRED");
        break;
      case "AUTOMATED_VERIFICATION":
        requireGuard(context.artifactProvenanceValid, "ARTIFACT_PROVENANCE_REQUIRED");
        break;
      case "HUMAN_APPROVAL":
        requireGuard(context.verificationStatus === "PASSED", "AUTOMATED_VERIFICATION_MUST_PASS");
        break;
      case "PRODUCTION_ROLLOUT_AUDITED":
        requireGuard(context.humanApprovalValid, "HUMAN_APPROVAL_REQUIRED");
        requireGuard(context.rolloutSucceeded, "ROLLOUT_SUCCESS_REQUIRED");
        break;
      case "INTENT_CAPTURED":
        throw new ControlPlaneError("INVALID_TRANSITION", "CANNOT_TRANSITION_TO_INITIAL_STATE");
    }

    return Object.freeze({ from: mission.state, to, nextVersion: mission.version + 1n });
  }
}

function requireGuard(value: boolean, reason: string): void {
  if (!value) throw new ControlPlaneError("GUARD_FAILED", reason);
}
