import { sha256, type AuditLedger } from "@klyn/governance";
import type {
  AgentBehaviorEvent,
  AgentBehaviorSnapshot,
  AgentBehaviorTraceRecord,
} from "./types.js";
import { toJsonValue } from "./json.js";

const GENESIS_HASH = "0".repeat(64);

function hashRecord(
  sequence: number,
  previousHash: string,
  event: AgentBehaviorEvent,
): string {
  return sha256(
    JSON.stringify(
      toJsonValue({
        sequence,
        previousHash,
        event,
      }),
    ),
  );
}

function freezeEvent(event: AgentBehaviorEvent): AgentBehaviorEvent {
  return Object.freeze({
    ...event,
    sideEffects: event.sideEffects === undefined
      ? undefined
      : Object.freeze(event.sideEffects.map((effect) => Object.freeze({ ...effect }))),
    metadata: event.metadata === undefined
      ? undefined
      : Object.freeze({ ...event.metadata }),
    toolCall: event.toolCall === undefined
      ? undefined
      : Object.freeze({
          ...event.toolCall,
          sideEffects: Object.freeze(event.toolCall.sideEffects.map((effect) => Object.freeze({ ...effect }))),
        }),
    memoryMutation: event.memoryMutation === undefined ? undefined : Object.freeze({ ...event.memoryMutation }),
    delegation: event.delegation === undefined
      ? undefined
      : Object.freeze({
          ...event.delegation,
          delegatedToolNames: Object.freeze([...event.delegation.delegatedToolNames]),
        }),
  });
}

export class AgentBehaviorTrace {
  private readonly records: AgentBehaviorTraceRecord[] = [];

  public constructor(
    private readonly audit?: AuditLedger,
  ) {}

  public append(event: AgentBehaviorEvent): AgentBehaviorTraceRecord {
    if (!event.missionId.trim()) throw new Error("missionId is required");
    if (!event.agentId.trim()) throw new Error("agentId is required");
    if (!event.policyVersion.trim()) throw new Error("policyVersion is required");
    if (!Number.isFinite(event.timestampEpochMs)) throw new Error("event timestamp must be finite");

    const previousHash = this.records.at(-1)?.hash ?? GENESIS_HASH;
    const sequence = this.records.length + 1;
    const frozenEvent = freezeEvent(event);
    const record = Object.freeze({
      sequence,
      previousHash,
      event: frozenEvent,
      hash: hashRecord(sequence, previousHash, frozenEvent),
    });

    this.records.push(record);

    if (this.audit) {
      this.audit.append({
        kind: "agent-behavior",
        missionId: event.missionId,
        agentId: event.agentId,
        sequence,
        eventType: event.eventType,
        traceDigest: record.hash,
        policyVersion: event.policyVersion,
        timestampEpochMs: event.timestampEpochMs,
      });
    }

    return record;
  }

  public verify(): boolean {
    let previousHash = GENESIS_HASH;

    for (let index = 0; index < this.records.length; index += 1) {
      const record = this.records[index];
      if (record === undefined) return false;
      if (record.sequence !== index + 1) return false;
      if (record.previousHash !== previousHash) return false;
      if (record.hash !== hashRecord(record.sequence, record.previousHash, record.event)) return false;
      previousHash = record.hash;
    }

    return true;
  }

  public snapshot(): AgentBehaviorSnapshot {
    return Object.freeze({
      missionId: this.records[0]?.event.missionId ?? "",
      agentId: this.records[0]?.event.agentId ?? "",
      length: this.records.length,
      headHash: this.records.at(-1)?.hash ?? GENESIS_HASH,
      records: Object.freeze([...this.records]),
    });
  }
}
