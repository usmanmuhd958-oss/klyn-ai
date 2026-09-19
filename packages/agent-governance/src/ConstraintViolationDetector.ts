import { digestJson } from "@klyn/governance";
import type {
  AgentBehaviorEvent,
  AgentBehaviorTraceRecord,
  BehaviorPolicy,
  ConstraintEvaluation,
  ConstraintViolation,
  SideEffectObservation,
} from "./types.js";
import { toJsonValue } from "./json.js";

const stateChangingEventTypes = new Set([
  "tool-call",
  "memory-mutation",
  "delegation",
  "side-effect-observation",
]);

function violation(
  kind: ConstraintViolation["kind"],
  record: AgentBehaviorTraceRecord,
  message: string,
): ConstraintViolation {
  return Object.freeze({
    kind,
    sequence: record.sequence,
    message,
    evidenceDigest: record.hash,
    timestampEpochMs: record.event.timestampEpochMs,
  });
}

function operationAllowed(
  policy: BehaviorPolicy,
  event: AgentBehaviorEvent,
): boolean {
  if (!event.toolCall) return true;
  const operations = policy.allowedToolOperations[event.toolCall.toolName];
  return operations?.includes(event.toolCall.operation) ?? false;
}

function sideEffectAllowed(
  policy: BehaviorPolicy,
  sideEffect: SideEffectObservation,
): boolean {
  return policy.allowedSideEffects.includes(sideEffect.kind);
}

export class ConstraintViolationDetector {
  private readonly violations: ConstraintViolation[] = [];
  private lastTimestamp = -Infinity;
  private lastSequence = 0;

  public constructor(private readonly policy: BehaviorPolicy) {
    if (policy.missionId.trim().length === 0) throw new Error("policy missionId is required");
    if (policy.agentId.trim().length === 0) throw new Error("policy agentId is required");
    if (policy.expectedPolicyVersion.trim().length === 0) throw new Error("expectedPolicyVersion is required");
    if (!Number.isInteger(policy.maxDelegationDepth) || policy.maxDelegationDepth < 0) {
      throw new Error("maxDelegationDepth must be a non-negative integer");
    }
  }

  public observe(record: AgentBehaviorTraceRecord): ConstraintEvaluation {
    const event = record.event;
    const currentViolations: ConstraintViolation[] = [];

    if (record.sequence !== this.lastSequence + 1) {
      currentViolations.push(violation("invalid-trace-sequence", record, "trace sequence is not contiguous"));
    }
    if (event.timestampEpochMs < this.lastTimestamp) {
      currentViolations.push(violation("invalid-trace-sequence", record, "behavior event timestamp moved backwards"));
    }
    if (event.missionId !== this.policy.missionId) {
      currentViolations.push(violation("policy-drift", record, "event missionId does not match monitored mission"));
    }
    if (event.agentId !== this.policy.agentId) {
      currentViolations.push(violation("policy-drift", record, "event agentId does not match monitored agent"));
    }
    if (event.policyVersion !== this.policy.expectedPolicyVersion) {
      currentViolations.push(violation("policy-drift", record, "behavior event policy version drifted from the authorized policy"));
    }

    if (event.eventType === "tool-call") {
      if (this.policy.requireToolAuthorization && !event.toolCall?.authorization.allowed) {
        currentViolations.push(violation("missing-authorization", record, "tool call is not backed by an allowed governance decision"));
      }
      if (!operationAllowed(this.policy, event)) {
        currentViolations.push(violation("policy-drift", record, "tool operation is outside the monitored policy"));
      }
    }

    const effects = [
      ...(event.sideEffects ?? []),
      ...(event.toolCall?.sideEffects ?? []),
    ];
    for (const effect of effects) {
      if (!sideEffectAllowed(this.policy, effect)) {
        currentViolations.push(
          violation(
            "unauthorized-side-effect",
            record,
            `side effect ${effect.kind}:${effect.locator} is outside the allowed side-effect policy`,
          ),
        );
      }
    }

    if (event.eventType === "memory-mutation" && event.memoryMutation) {
      const mutation = event.memoryMutation;
      if (
        this.policy.requireStateDigestChangeForMutation
        && mutation.beforeDigest === mutation.afterDigest
      ) {
        currentViolations.push(violation("hidden-state-shift", record, "memory mutation did not produce a state digest change"));
      }
      if (!mutation.declared) {
        currentViolations.push(violation("hidden-state-shift", record, "memory mutation was observed outside the declared mutation set"));
      }
    }

    if (stateChangingEventTypes.has(event.eventType) && event.stateDigestBefore === event.stateDigestAfter) {
      if (event.eventType === "memory-mutation") {
        currentViolations.push(violation("hidden-state-shift", record, "state-changing memory event has identical before/after state digest"));
      }
    }

    if (this.policy.requireExplicitSideEffectDeclaration && event.eventType === "side-effect-observation") {
      for (const effect of effects) {
        if (!event.metadata?.["declaredEffectIds"]?.split(",").includes(effect.effectId)) {
          currentViolations.push(violation("unauthorized-side-effect", record, "observed side effect was not explicitly declared"));
        }
      }
    }

    if (event.eventType === "delegation" && event.delegation) {
      const delegation = event.delegation;
      if (delegation.depth > this.policy.maxDelegationDepth) {
        currentViolations.push(violation("invalid-delegation", record, "delegation depth exceeds the authorized maximum"));
      }
      if (delegation.parentAgentId !== event.agentId) {
        currentViolations.push(violation("invalid-delegation", record, "delegation parent does not match the emitting agent"));
      }
      if (delegation.childAgentId === delegation.parentAgentId) {
        currentViolations.push(violation("invalid-delegation", record, "agent cannot delegate authority to itself"));
      }
    }

    this.lastSequence = record.sequence;
    this.lastTimestamp = Math.max(this.lastTimestamp, event.timestampEpochMs);
    this.violations.push(...currentViolations);

    return Object.freeze({
      accepted: currentViolations.length === 0,
      violations: Object.freeze(currentViolations),
      traceHeadHash: record.hash,
      evaluatedSequence: record.sequence,
    });
  }

  public snapshotViolations(): readonly ConstraintViolation[] {
    return Object.freeze([...this.violations]);
  }

  public clear(): void {
    this.violations.length = 0;
    this.lastSequence = 0;
    this.lastTimestamp = -Infinity;
  }
}

export function behaviorEventDigest(event: AgentBehaviorEvent): string {
  return digestJson(
    toJsonValue({
      eventType: event.eventType,
      missionId: event.missionId,
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      graphNodeId: event.graphNodeId,
      timestampEpochMs: event.timestampEpochMs,
      policyVersion: event.policyVersion,
      stateDigestBefore: event.stateDigestBefore,
      stateDigestAfter: event.stateDigestAfter,
      toolCall: event.toolCall,
      memoryMutation: event.memoryMutation,
      delegation: event.delegation,
      sideEffects: event.sideEffects,
      metadata: event.metadata,
    }),
  );
}
