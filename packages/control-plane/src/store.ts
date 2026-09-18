import { calculateLedgerHash, hashPayload } from "./canonical.js";
import { ControlPlaneError } from "./errors.js";
import { newEventId } from "./ids.js";
import { BREAKER_ORDER } from "./types.js";
import type { LedgerEvent, LedgerEventInput, MissionId, MissionRecord, MissionState, BreakerLevel } from "./types.js";
import { brand } from "./types.js";

const ZERO_HASH = brand<string, "SHA256Hex">("0".repeat(64));

export interface AtomicTransitionInput {
  readonly missionId: MissionId;
  readonly expectedVersion: bigint;
  readonly fromState: MissionState;
  readonly toState: MissionState;
  readonly event: LedgerEventInput;
}

export interface MissionLedgerStore {
  createMission(mission: MissionRecord, initialEvent: LedgerEventInput): Promise<{ readonly mission: MissionRecord; readonly event: LedgerEvent }>;
  readMission(missionId: MissionId): Promise<MissionRecord | undefined>;
  transitionAtomically(input: AtomicTransitionInput): Promise<{ readonly mission: MissionRecord; readonly event: LedgerEvent }>;
  triggerBreakerAtomically(missionId: MissionId, level: BreakerLevel, reason: string, event: LedgerEventInput): Promise<{ readonly mission: MissionRecord; readonly event: LedgerEvent }>;
  readEvents(missionId: MissionId): Promise<readonly LedgerEvent[]>;
}

export class InMemoryMissionLedgerStore implements MissionLedgerStore {
  private readonly missions = new Map<string, MissionRecord>();
  private readonly events = new Map<string, LedgerEvent[]>();
  private readonly locks = new Map<string, Promise<void>>();

  async createMission(mission: MissionRecord, initialEvent: LedgerEventInput): Promise<{ readonly mission: MissionRecord; readonly event: LedgerEvent }> {
    return this.withMissionLock(mission.missionId, async () => {
      if (this.missions.has(mission.missionId)) throw new ControlPlaneError("DUPLICATE_IDEMPOTENCY_KEY", "MISSION_ALREADY_EXISTS");
    const event = await this.appendEvent(mission.missionId, initialEvent);
    const committed = Object.freeze({ ...mission, ledgerSequence: event.sequence, ledgerHeadHash: event.eventHash });
    this.missions.set(mission.missionId, committed);
      return { mission: committed, event };
    });
  }

  async readMission(missionId: MissionId): Promise<MissionRecord | undefined> {
    return this.missions.get(missionId);
  }

  async transitionAtomically(input: AtomicTransitionInput): Promise<{ readonly mission: MissionRecord; readonly event: LedgerEvent }> {
    return this.withMissionLock(input.missionId, async () => {
      const current = this.missions.get(input.missionId);
    if (!current) throw new ControlPlaneError("STATE_CONFLICT", "MISSION_NOT_FOUND");
    if (current.version !== input.expectedVersion || current.state !== input.fromState) throw new ControlPlaneError("STATE_CONFLICT", "ATOMIC_TRANSITION_PRECONDITION_FAILED");
    if (current.breakerLevel !== "NONE") throw new ControlPlaneError("BREAKER_ACTIVE", "MISSION_BREAKER_ACTIVE");

    const event = await this.appendEvent(input.missionId, input.event);
    const next = Object.freeze({
      ...current,
      state: input.toState,
      version: current.version + 1n,
      updatedAt: input.event.occurredAt,
      ledgerSequence: event.sequence,
      ledgerHeadHash: event.eventHash,
    });
    this.missions.set(input.missionId, next);
      return { mission: next, event };
    });
  }

  async triggerBreakerAtomically(missionId: MissionId, level: BreakerLevel, reason: string, event: LedgerEventInput): Promise<{ readonly mission: MissionRecord; readonly event: LedgerEvent }> {
    return this.withMissionLock(missionId, async () => {
      const current = this.missions.get(missionId);
    if (!current) throw new ControlPlaneError("STATE_CONFLICT", "MISSION_NOT_FOUND");
    const ledgerEvent = await this.appendEvent(missionId, event);
    const effectiveLevel = BREAKER_ORDER[level] >= BREAKER_ORDER[current.breakerLevel] ? level : current.breakerLevel;
    const next = Object.freeze({
      ...current,
      breakerLevel: effectiveLevel,
      ...(effectiveLevel === level ? { breakerReason: reason } : {}),
      updatedAt: event.occurredAt,
      ledgerSequence: ledgerEvent.sequence,
      ledgerHeadHash: ledgerEvent.eventHash,
    });
    this.missions.set(missionId, next);
      return { mission: next, event: ledgerEvent };
    });
  }

  private async withMissionLock<T>(missionId: MissionId, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(missionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(missionId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(missionId) === tail) this.locks.delete(missionId);
    }
  }

  async readEvents(missionId: MissionId): Promise<readonly LedgerEvent[]> {
    return Object.freeze([...(this.events.get(missionId) ?? [])]);
  }

  private async appendEvent(missionId: MissionId, input: LedgerEventInput): Promise<LedgerEvent> {
    const list = this.events.get(missionId) ?? [];
    const sequence = BigInt(list.length + 1);
    const previousHash = list.at(-1)?.eventHash ?? ZERO_HASH;
    const payloadHash = await hashPayload(input.payload);
    const eventId = newEventId();
    const eventHash = await calculateLedgerHash({ ...input, eventId, sequence, previousHash, payloadHash });
    const event: LedgerEvent = { ...input, eventId, sequence, previousHash, payloadHash, eventHash };
    list.push(event);
    this.events.set(missionId, list);
    return event;
  }
}
