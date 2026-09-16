import { createHash } from "node:crypto";

export type ObservationEventType =
  | "process.started"
  | "stdout"
  | "stderr"
  | "filesystem.created"
  | "filesystem.modified"
  | "filesystem.deleted"
  | "resource.snapshot"
  | "process.exited"
  | "sandbox.rollback";

export interface ObservationClock {
  now(): number;
}

export interface ObservationEventInput {
  readonly type: ObservationEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ObservationEvent extends ObservationEventInput {
  readonly executionId: string;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly previousHash: string;
  readonly hash: string;
}

export interface ObservationSessionMetadata {
  readonly executionId: string;
  readonly taskId: string;
  readonly agentId: string;
}

export interface ObservationSnapshot {
  readonly events: readonly ObservationEvent[];
  readonly streamHash: string;
}

export const SYSTEM_CLOCK: ObservationClock = Object.freeze({
  now: (): number => Date.now(),
});

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(object[key]);
    return result;
  }, {});
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export class ObservationCollector {
  private readonly events: ObservationEvent[] = [];
  private metadata: ObservationSessionMetadata | undefined;
  private sequence = 0;
  private previousHash = "0".repeat(64);

  constructor(private readonly clock: ObservationClock = SYSTEM_CLOCK) {}

  createChild(): ObservationCollector {
    return new ObservationCollector(this.clock);
  }

  begin(metadata: ObservationSessionMetadata): void {
    if (this.metadata !== undefined) throw new Error("Observation session has already started");
    if (!metadata.executionId || !metadata.taskId || !metadata.agentId) throw new Error("Observation metadata is incomplete");
    this.metadata = Object.freeze({ ...metadata });
  }

  record(type: ObservationEventType, payload: Readonly<Record<string, unknown>>): ObservationEvent {
    if (this.metadata === undefined) throw new Error("Observation session has not started");
    const input = {
      executionId: this.metadata.executionId,
      sequence: this.sequence,
      timestampMs: this.clock.now(),
      type,
      payload: canonicalize(payload) as Readonly<Record<string, unknown>>,
      previousHash: this.previousHash,
    } as const;
    const event: ObservationEvent = Object.freeze({
      ...input,
      hash: digest(input),
    });
    this.events.push(event);
    this.sequence += 1;
    this.previousHash = event.hash;
    return event;
  }

  recordFilesystemMutations(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): void {
    const paths = new Set([...before.keys(), ...after.keys()]);
    const sortedPaths = [...paths].sort();
    for (const path of sortedPaths) {
      const oldDigest = before.get(path);
      const newDigest = after.get(path);
      if (oldDigest === undefined && newDigest !== undefined) {
        this.record("filesystem.created", { path, digest: newDigest });
      } else if (oldDigest !== undefined && newDigest === undefined) {
        this.record("filesystem.deleted", { path, previousDigest: oldDigest });
      } else if (oldDigest !== newDigest) {
        this.record("filesystem.modified", { path, previousDigest: oldDigest ?? null, digest: newDigest ?? null });
      }
    }
  }

  finalize(): ObservationSnapshot {
    if (this.metadata === undefined) throw new Error("Observation session has not started");
    return Object.freeze({
      events: Object.freeze([...this.events]),
      streamHash: this.previousHash,
    });
  }
}
