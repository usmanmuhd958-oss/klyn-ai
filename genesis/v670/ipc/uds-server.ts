/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Unix Domain Socket Server
 * File: genesis/v670/ipc/uds-server.ts
 * Version: 1.0.0
 *
 * Zero-copy-lite, sub-millisecond IPC transport over a Unix domain socket.
 *   - Length-prefixed JSON frames (see protocol.ts).
 *   - Request/reply correlation with timeouts.
 *   - Broadcast fan-out to connected peers.
 *   - Per-connection error isolation (one bad peer cannot take down the bus).
 *   - Round-trip latency instrumentation (p50/p95/p99).
 *
 * Note: on non-POSIX platforms (Windows) this transport is unavailable and
 * the omniversal kernel degrades to the in-process bus only.
 * =============================================================================
 */

import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  V670_OP,
  encodeFrame,
  computeLatency,
  pushLatency,
  makeEnvelope,
  type V670Envelope,
} from './protocol.js';
import { randomUUID } from 'node:crypto';

export interface UdsServerOptions {
  socketPath?: string;
  maxClients?: number;
  heartbeatMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_HEARTBEAT_MS = 5000;

export class UdsServer extends EventEmitter {
  [key: string]: any;
  private socketPath: string;
  private server: net.Server | null = null;
  private peers = new Map<string, net.Socket>();
  private pending = new Map<string, PendingRequest>();
  private latencySamples: number[] = [];
  private startedAt: number | null = null;
  private heartbeatMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private totalRequests = 0;
  private totalErrors = 0;
  private maxClients: number;

  constructor(options: UdsServerOptions = {}) {
    super();
    this.maxClients = options.maxClients ?? 256;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.socketPath = options.socketPath ?? path.join(os.tmpdir(), `klyn-v670-${process.pid}.sock`);
  }

  /** Bind and start listening. Resolves with the socket path. */
  public async start(): Promise<string> {
    // Remove a stale socket file if present.
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* not present — fine */
    }

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', (err) => reject(err));
      this.server.listen(this.socketPath, () => {
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch {
          /* permissions not critical */
        }
        resolve();
      });
    });

    this.startedAt = Date.now();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), this.heartbeatMs);
    this.heartbeatTimer.unref?.();
    return this.socketPath;
  }

  /** Stop listening, reject pending requests, close all peers. */
  public async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [corr, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('UDS server stopped'));
      this.pending.delete(corr);
    }
    for (const socket of this.peers.values()) {
      socket.destroy();
    }
    this.peers.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
  }

  /** Send a request and await the correlated reply. */
  public request(to: string, op: string, body?: unknown, timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const corr = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(corr);
        reject(new Error(`UDS request to '${to}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(corr, { resolve, reject, timer });

      const started = Date.now();
      const envelope = makeEnvelope(op as any, 'v670-server', to, body, corr);
      try {
        this.sendTo(to, envelope);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(corr);
        reject(err);
        return;
      }

      // Replace resolve to capture latency.
      const original = this.pending.get(corr)!;
      original.resolve = (value: unknown) => {
        pushLatency(this.latencySamples, Date.now() - started);
        resolve(value);
      };
    });
  }

  /** Fire-and-forget broadcast to all connected peers. */
  public broadcast(op: string, body?: unknown, exclude?: string): number {
    const envelope = makeEnvelope(op as any, 'v670-server', 'broadcast', body);
    let sent = 0;
    for (const [id, socket] of this.peers) {
      if (id === exclude) continue;
      try {
        socket.write(encodeFrame(envelope) as any);
        sent++;
      } catch {
        /* skip failed peer */
      }
    }
    return sent;
  }

  public get peerCount(): number {
    return this.peers.size;
  }

  public getLatency() {
    return computeLatency(this.latencySamples);
  }

  public getStats() {
    return {
      uptimeMs: this.startedAt === null ? 0 : Date.now() - this.startedAt,
      peers: this.peers.size,
      pendingRequests: this.pending.size,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      latency: this.getLatency(),
      socketPath: this.socketPath,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private handleConnection(socket: net.Socket): void {
    if (this.peers.size >= this.maxClients) {
      socket.destroy();
      return;
    }

    const peerId = `${socket.remoteAddress ?? 'local'}:${socket.remotePort ?? 'anon'}`;
    const parser = (socket as any).__v670Parser;
    void parser; // parser lives on the socket below

    this.peers.set(peerId, socket);
    socket.on('data', (chunk) => this.handleData(socket, chunk as Buffer));
    socket.on('error', () => this.dropPeer(socket));
    socket.on('close', () => this.dropPeer(socket));
    socket.on('end', () => this.dropPeer(socket));
  }

  private handleData(socket: net.Socket, chunk: Buffer): void {
    const state = getParserState(socket);
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
      this.dispatch(envelope, socket);
    }
  }

  private dispatch(envelope: V670Envelope, socket: net.Socket): void {
    const { op, corr } = envelope;

    if (op === V670_OP.REPLY && corr && this.pending.has(corr)) {
      this.totalRequests++;
      const pending = this.pending.get(corr)!;
      this.pending.delete(corr);
      clearTimeout(pending.timer);
      if (envelope.err) {
        this.totalErrors++;
        pending.reject(new Error(`${envelope.err.code}: ${envelope.err.message}`));
      } else {
        pending.resolve(envelope.body);
      }
      return;
    }

    if (op === V670_OP.PING) {
      socket.write(encodeFrame(makeEnvelope(V670_OP.PONG, 'v670-server', envelope.from, envelope.body, corr ?? undefined as any)) as any);
      return;
    }

    if (op === V670_OP.REQUEST || op === V670_OP.TASK || op === V670_OP.EVENT) {
      this.emit('message', envelope, socket);
      return;
    }

    this.emit('message', envelope, socket);
  }

  private sendTo(to: string, envelope: V670Envelope): void {
    const socket = this.peers.get(to);
    if (!socket) throw new Error(`UDS peer '${to}' not connected`);
    socket.write(encodeFrame(envelope) as any);
  }

  private sendHeartbeats(): void {
    const envelope = makeEnvelope(V670_OP.HEARTBEAT, 'v670-server', 'broadcast');
    for (const socket of this.peers.values()) {
      try {
        socket.write(encodeFrame(envelope) as any);
      } catch {
        /* drop on write failure */
      }
    }
  }

  private dropPeer(socket: net.Socket): void {
    for (const [id, s] of this.peers) {
      if (s === socket) {
        this.peers.delete(id);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PRIVATE PARSER STATE HELPER
// ---------------------------------------------------------------------------

const PARSER_STATE = Symbol('v670ParserState');

interface ParserState {
  buffer: Buffer;
}

function getParserState(socket: net.Socket): ParserState {
  let state = (socket as any)[PARSER_STATE] as ParserState | undefined;
  if (!state) {
    state = { buffer: Buffer.alloc(0) };
    (socket as any)[PARSER_STATE] = state;
  }
  return state;
}

// Re-export for consumers that want the encode path alongside the server.
export { encodeFrame, V670_OP };
