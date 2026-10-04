import { sha256 } from "./crypto.js";
import { canonicalJson } from "./canonical.js";
import { newExecutionId, newEventId } from "./ids.js";
import type { AgentId, EventId, ExecutionId, Hash256, MissionId } from "./types.js";

export interface TraceSpan {
  readonly executionId: ExecutionId;
  readonly spanId: EventId;
  readonly missionId: MissionId;
  readonly agentId: AgentId;
  readonly parentSpanId?: EventId;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly eventDigests: readonly Hash256[];
}

export class BlackBoxTraceEngine {
  private readonly spans = new Map<string, TraceSpan>();

  startSpan(missionId: MissionId, agentId: AgentId, parentSpanId?: EventId, attributes: Readonly<Record<string, string | number | boolean>> = {}): TraceSpan {
    const base = { executionId: newExecutionId(), spanId: newEventId(), missionId, agentId, startedAt: new Date().toISOString(), attributes, eventDigests: [] as readonly Hash256[] };
    const span: TraceSpan = parentSpanId === undefined ? base : { ...base, parentSpanId };
    this.spans.set(span.spanId, span);
    return span;
  }

  async record(spanId: EventId, payload: unknown): Promise<TraceSpan> {
    const span = this.require(spanId);
    const digest = await sha256(canonicalJson(payload));
    const next = { ...span, eventDigests: Object.freeze([...span.eventDigests, digest as Hash256]) };
    this.spans.set(spanId, next);
    return next;
  }

  end(spanId: EventId, endedAt = new Date().toISOString()): TraceSpan {
    const span = this.require(spanId);
    const next = { ...span, endedAt, eventDigests: Object.freeze([...span.eventDigests]) };
    this.spans.set(spanId, next);
    return next;
  }

  get(spanId: EventId): TraceSpan | undefined { return this.spans.get(spanId); }

  private require(spanId: EventId): TraceSpan {
    const span = this.spans.get(spanId);
    if (!span) throw new Error(`TRACE_SPAN_NOT_FOUND:${spanId}`);
    return span;
  }
}
