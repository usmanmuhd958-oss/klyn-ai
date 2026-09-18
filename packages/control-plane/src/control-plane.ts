import { CircuitBreakerEngine } from "./breaker.js";
import { ControlPlaneError } from "./errors.js";
import { newMissionId } from "./ids.js";
import { AnomalyEngine } from "./anomaly.js";
import { VMGEngine } from "./vmg.js";
import { InMemoryMissionLedgerStore, type MissionLedgerStore } from "./store.js";
import type { ActorIdentity, AnomalyVector, CreateMissionInput, LedgerEventInput, MissionRecord, MissionState, TransitionContext } from "./types.js";

export class KlynControlPlane {
  readonly vmg = new VMGEngine();
  readonly anomaly = new AnomalyEngine();
  readonly breakers = new CircuitBreakerEngine();

  constructor(readonly store: MissionLedgerStore = new InMemoryMissionLedgerStore()) {}

  async createMission(input: Omit<CreateMissionInput, "missionId">): Promise<MissionRecord> {
    const missionId = newMissionId();
    const mission: MissionRecord = {
      missionId,
      tenantId: input.tenantId,
      policyId: input.policyId,
      state: "INTENT_CAPTURED",
      version: 0n,
      breakerLevel: "NONE",
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      ledgerSequence: 0n,
      ledgerHeadHash: "0".repeat(64) as MissionRecord["ledgerHeadHash"],
    };
    const event: LedgerEventInput = {
      missionId,
      eventType: "MissionCreated",
      occurredAt: input.occurredAt,
      actor: input.actor,
      schemaVersion: 1,
      payload: { objective: input.objective, constraints: input.constraints },
    };
    return (await this.store.createMission(mission, event)).mission;
  }

  async transition(missionId: MissionRecord["missionId"], toState: MissionState, expectedVersion: bigint, context: TransitionContext, actor: ActorIdentity, payload: unknown, occurredAt: string): Promise<MissionRecord> {
    const mission = await this.store.readMission(missionId);
    if (!mission) throw new ControlPlaneError("STATE_CONFLICT", "MISSION_NOT_FOUND");
    const decision = this.vmg.transition(mission, toState, expectedVersion, context);
    const event: LedgerEventInput = {
      missionId,
      eventType: "StateTransitionCommitted",
      occurredAt,
      actor,
      schemaVersion: 1,
      payload: { fromState: decision.from, toState: decision.to, expectedVersion: expectedVersion.toString(), ...asObject(payload) },
    };
    return (await this.store.transitionAtomically({ missionId, expectedVersion, fromState: decision.from, toState: decision.to, event })).mission;
  }

  async evaluateAnomaly(missionId: MissionRecord["missionId"], actor: ActorIdentity, input: { readonly expected: AnomalyVector; readonly observed: AnomalyVector; readonly systemBaseline: AnomalyVector; readonly hardViolations?: readonly string[] }, occurredAt: string): Promise<void> {
    const evidence = this.anomaly.evaluate(input);
    if (evidence.breakerLevel === "NONE") return;
    const reason = evidence.hardViolations.join(",") || `behavioral=${evidence.behavioralDistance.toFixed(6)} system=${evidence.systemDriftDistance.toFixed(6)}`;
    const event: LedgerEventInput = { missionId, eventType: "CircuitBreakerTriggered", occurredAt, actor, schemaVersion: 1, payload: { evidence } };
    await this.store.triggerBreakerAtomically(missionId, evidence.breakerLevel, reason, event);
    this.breakers.trigger(missionId, evidence.breakerLevel, reason, occurredAt);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { detail: value };
  return value as Record<string, unknown>;
}
