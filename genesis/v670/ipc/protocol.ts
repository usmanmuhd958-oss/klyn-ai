/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — IPC Wire Protocol
 * File: genesis/v670/ipc/protocol.ts
 * Version: 1.0.0
 *
 * The sub-millisecond inter-process protocol. Frames are length-prefixed
 * UTF-8 JSON: [u32 BE length][payload]. Requests and replies correlate via
 * a correlation id. All timestamps are process-local milliseconds.
 * =============================================================================
 */

export const V670_OP = {
  PING: 'ping',
  PONG: 'pong',
  HELLO: 'hello',
  REGISTER: 'register',
  TASK: 'task',
  EVENT: 'event',
  REQUEST: 'request',
  REPLY: 'reply',
  ERROR: 'error',
  HEARTBEAT: 'heartbeat',
  SHUTDOWN: 'shutdown',
} as const;

export type V670Opcode = (typeof V670_OP)[keyof typeof V670_OP];

export interface V670Envelope {
  v: 1;
  op: V670Opcode;
  id: string;
  from: string;
  to: string;
  corr: string | null;
  ts: number;
  body?: unknown;
  err?: { code: string; message: string } | null;
}

export interface V670Error {
  code: string;
  message: string;
}

const HEADER_SIZE = 4;
const MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16 MiB safety cap

let envelopeSeq = 0;

/** Create an envelope with a fresh id. */
export function makeEnvelope(
  op: V670Opcode,
  from: string,
  to: string,
  body?: unknown,
  corr: string | null = null,
  err: V670Error | null = null
): V670Envelope {
  return {
    v: 1,
    op,
    id: `v670_${++envelopeSeq}_${Date.now()}`,
    from,
    to,
    corr,
    ts: Date.now(),
    body,
    err,
  };
}

/** Serialize an envelope into a length-prefixed frame. */
export function encodeFrame(envelope: V670Envelope): Buffer {
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]) as Buffer;
}

/**
 * Incremental frame parser. Feed it raw socket chunks; it returns complete
 * envelopes and retains partial frames for the next call.
 */
export class FrameParser {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  public feed(chunk: Buffer): V670Envelope[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const envelopes: V670Envelope[] = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const length = this.buffer.readUInt32BE(0);
      if (length <= 0 || length > MAX_FRAME_SIZE) {
        // Protocol corruption — drop everything to resync.
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (this.buffer.length < HEADER_SIZE + length) break;

      const payload = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + length).toString('utf8');
      this.buffer = this.buffer.subarray(HEADER_SIZE + length);

      try {
        envelopes.push(JSON.parse(payload) as V670Envelope);
      } catch {
        // Malformed envelope — skip.
      }
    }

    return envelopes;
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

// ---------------------------------------------------------------------------
// LATENCY INSTRUMENTATION
// ---------------------------------------------------------------------------

const LATENCY_MAX_SAMPLES = 10_000;

export function pushLatency(samples: number[], valueMs: number): void {
  samples.push(valueMs);
  if (samples.length > LATENCY_MAX_SAMPLES) {
    samples.splice(0, samples.length - LATENCY_MAX_SAMPLES);
  }
}

export function computeLatency(samples: number[]): {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
} {
  if (samples.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export default V670_OP;
