/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Unix Domain Socket Client
 * File: genesis/v670/ipc/uds-client.ts
 * Version: 1.0.0
 *
 * Auto-reconnecting UDS client with request/reply correlation, subscribe
 * handlers, and round-trip latency instrumentation.
 * =============================================================================
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  V670_OP,
  encodeFrame,
  computeLatency,
  pushLatency,
  makeEnvelope,
  type V670Envelope,
} from './protocol.js';

export interface UdsClientOptions {
  reconnectMs?: number;
  maxReconnects?: number;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class UdsClient extends EventEmitter {
  [key: string]: any;
  private socketPath: string;
  private socket: net.Socket | null = null;
  private pending = new Map<string, PendingRequest>();
  private latencySamples: number[] = [];
  private reconnectMs: number;
  private maxReconnects: number;
  private reconnectCount = 0;
  private timeoutMs: number;
  private closed = false;
  private connectedAt: number | null = null;

  constructor(socketPath: string, options: UdsClientOptions = {}) {
    super();
    this.socketPath = socketPath;
    this.reconnectMs = options.reconnectMs ?? 250;
    this.maxReconnects = options.maxReconnects ?? 10;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  /** Connect (with automatic reconnect on failure). */
  public async connect(): Promise<void> {
    this.closed = false;
    await this.tryConnect();
  }

  /** Send a request and await the correlated reply. */
  public request(op: string, body?: unknown, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connectedAt) {
        reject(new Error('UDS client not connected'));
        return;
      }
      const corr = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(corr);
        reject(new Error(`UDS request '${op}' timed out after ${timeoutMs ?? this.timeoutMs}ms`));
      }, timeoutMs ?? this.timeoutMs);
      this.pending.set(corr, { resolve, reject, timer });

      const started = Date.now();
      const envelope = makeEnvelope(op as any, `v670-client-${process.pid}`, 'v670-server', body, corr);
      try {
        this.socket.write(encodeFrame(envelope) as any);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(corr);
        reject(err);
      }

      // Wrap resolve to record latency.
      const original = this.pending.get(corr)!;
      original.resolve = (value: unknown) => {
        pushLatency(this.latencySamples, Date.now() - started);
        resolve(value);
      };
    });
  }

  /** Fire-and-forget send. */
  public send(op: string, body?: unknown): void {
    if (!this.socket) return;
    const envelope = makeEnvelope(op as any, `v670-client-${process.pid}`, 'v670-server', body);
    try {
      this.socket.write(encodeFrame(envelope) as any);
    } catch {
      /* drop */
    }
  }

  public isConnected(): boolean {
    return this.socket !== null && this.connectedAt !== null;
  }

  public getLatency() {
    return computeLatency(this.latencySamples);
  }

  public close(): void {
    this.closed = true;
    for (const [corr, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('UDS client closed'));
      this.pending.delete(corr);
    }
    this.socket?.destroy();
    this.socket = null;
    this.connectedAt = null;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath);
      socket.setNoDelay(true);

      const onConnect = () => {
        this.socket = socket;
        this.connectedAt = Date.now();
        this.reconnectCount = 0;
        socket.on('data', (chunk) => this.handleData(chunk as Buffer));
        socket.on('error', () => this.handleDisconnect());
        socket.on('close', () => this.handleDisconnect());
        this.emit('connect', this.socketPath);
        resolve();
      };

      const onError = (err: Error) => {
        socket.removeListener('connect', onConnect);
        if (this.closed) {
          reject(err);
          return;
        }
        if (this.reconnectCount >= this.maxReconnects) {
          reject(new Error(`UDS connect failed after ${this.maxReconnects} attempts: ${err.message}`));
          return;
        }
        this.reconnectCount++;
        setTimeout(() => {
          this.tryConnect().then(resolve).catch(reject);
        }, this.reconnectMs * Math.pow(1.5, this.reconnectCount - 1));
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
  }

  private handleData(chunk: Buffer): void {
    const state = getClientState(this);
    state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);

    while (state.buffer.length >= 4) {
      const length = state.buffer.readUInt32BE(0);
      if (length <= 0 || length > 16 * 1024 * 1024) {
        state.buffer = Buffer.alloc(0);
        return;
      }
      if (state.buffer.length < 4 + length) break;

      const payload = state.buffer.subarray(4, 4 + length).toString('utf8');
      state.buffer = state.buffer.subarray(4 + length);

      let envelope: V670Envelope;
      try {
        envelope = JSON.parse(payload) as V670Envelope;
      } catch {
        continue;
      }

      if (envelope.corr && this.pending.has(envelope.corr)) {
        const pending = this.pending.get(envelope.corr)!;
        this.pending.delete(envelope.corr);
        clearTimeout(pending.timer);
        if (envelope.err) {
          pending.reject(new Error(`${envelope.err.code}: ${envelope.err.message}`));
        } else {
          pending.resolve(envelope.body);
        }
        continue;
      }

      this.emit('message', envelope);
    }
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.connectedAt = null;
    this.emit('disconnect');
    if (!this.closed && this.reconnectCount < this.maxReconnects) {
      this.reconnectCount++;
      setTimeout(() => {
        if (!this.closed) {
          this.tryConnect().catch(() => this.handleDisconnect());
        }
      }, this.reconnectMs);
    }
  }
}

// ---------------------------------------------------------------------------
// PRIVATE CLIENT STATE
// ---------------------------------------------------------------------------

const CLIENT_STATE = Symbol('v670ClientState');

interface ClientState {
  buffer: Buffer;
}

function getClientState(client: UdsClient): ClientState {
  let state = (client as any)[CLIENT_STATE] as ClientState | undefined;
  if (!state) {
    state = { buffer: Buffer.alloc(0) };
    (client as any)[CLIENT_STATE] = state;
  }
  return state;
}

export { V670_OP, encodeFrame };
