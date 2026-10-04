import { sha256 } from "./crypto.js";
import type { LedgerEventInput, Hash256 } from "./types.js";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_NUMBER_IN_CANONICAL_DATA");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return JSON.stringify(`${value.toString()}n`);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}`;
  }
  throw new Error("UNSUPPORTED_CANONICAL_VALUE_TYPE");
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export async function hashPayload(payload: unknown): Promise<Hash256> {
  return sha256(canonicalJson(payload));
}

export async function calculateLedgerHash(
  event: Omit<LedgerEventInput, "payload"> & {
    readonly eventId: string;
    readonly sequence: bigint;
    readonly previousHash: Hash256;
    readonly payloadHash: Hash256;
  },
): Promise<Hash256> {
  const representation = canonicalJson({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    missionId: event.missionId,
    executionId: event.executionId ?? null,
    sequence: event.sequence.toString(),
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    actor: event.actor,
    authorization: event.authorization ?? null,
    previousHash: event.previousHash,
    payloadHash: event.payloadHash,
  });
  return sha256(representation);
}
