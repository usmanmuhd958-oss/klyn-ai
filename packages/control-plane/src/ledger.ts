import { calculateLedgerHash, hashPayload } from "./canonical.js";
import { ControlPlaneError } from "./errors.js";
import { newEventId } from "./ids.js";
import type { EventId, Hash256, LedgerEvent, LedgerEventInput, MissionId } from "./types.js";

export interface LedgerStore {
  append(input: LedgerEventInput): Promise<LedgerEvent>;
  list(missionId: MissionId): Promise<readonly LedgerEvent[]>;
  verify(missionId: MissionId): Promise<{ readonly valid: boolean; readonly firstInvalidSequence?: bigint }>;
}

export interface LedgerTransaction {
  append(input: LedgerEventInput): Promise<LedgerEvent>;
}

const ZERO_HASH = "0".repeat(64) as Hash256;

type MissionLedger = {
  events: LedgerEvent[];
  headHash: Hash256;
};

export class InMemoryLedgerStore implements LedgerStore {
  private readonly missions = new Map<string, MissionLedger>();
  private readonly idempotency = new Map<string, { eventId: EventId; payloadHash: Hash256 }>();

  async append(input: LedgerEventInput): Promise<LedgerEvent> {
    const idempotencyKey = typeof input.payload === "object" && input.payload !== null
      ? (input.payload as Record<string, unknown>).idempotencyKey
      : undefined;

    if (typeof idempotencyKey === "string") {
      const existing = this.idempotency.get(`${input.missionId}:${idempotencyKey}`);
      if (existing) {
        const payloadHash = await hashPayload(input.payload);
        if (payloadHash !== existing.payloadHash) throw new ControlPlaneError("IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
        const existingEvent = this.missions.get(input.missionId)?.events.find((event) => event.eventId === existing.eventId);
        if (!existingEvent) throw new ControlPlaneError("LEDGER_INTEGRITY_FAILURE", "IDEMPOTENCY_INDEX_CORRUPTED");
        return existingEvent;
      }
    }

    const bucket = this.missions.get(input.missionId) ?? { events: [], headHash: ZERO_HASH };
    const sequence = BigInt(bucket.events.length + 1);
    const payloadHash = await hashPayload(input.payload);
    const eventId = newEventId();
    const previousHash = bucket.headHash;
    const eventHash = await calculateLedgerHash({
      ...input,
      eventId,
      sequence,
      previousHash,
      payloadHash,
    });

    const event: LedgerEvent = {
      ...input,
      eventId,
      sequence,
      previousHash,
      payloadHash,
      eventHash,
    };

    bucket.events.push(event);
    bucket.headHash = eventHash;
    this.missions.set(input.missionId, bucket);
    if (typeof idempotencyKey === "string") this.idempotency.set(`${input.missionId}:${idempotencyKey}`, { eventId, payloadHash });
    return event;
  }

  async list(missionId: MissionId): Promise<readonly LedgerEvent[]> {
    return Object.freeze([...(this.missions.get(missionId)?.events ?? [])]);
  }

  async verify(missionId: MissionId): Promise<{ readonly valid: boolean; readonly firstInvalidSequence?: bigint }> {
    const events = this.missions.get(missionId)?.events ?? [];
    let previous = ZERO_HASH;
    let expectedSequence = 1n;
    for (const event of events) {
      if (event.sequence !== expectedSequence) return { valid: false, firstInvalidSequence: event.sequence };
      if (event.previousHash !== previous) return { valid: false, firstInvalidSequence: event.sequence };
      const expectedPayloadHash = await hashPayload(event.payload);
      if (expectedPayloadHash !== event.payloadHash) return { valid: false, firstInvalidSequence: event.sequence };
      const expectedEventHash = await calculateLedgerHash(event);
      if (expectedEventHash !== event.eventHash) return { valid: false, firstInvalidSequence: event.sequence };
      previous = event.eventHash;
      expectedSequence += 1n;
    }
    return { valid: true };
  }
}
