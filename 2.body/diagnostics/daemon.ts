/**
 * =============================================================================
 * KLYN AI OS — 2.body — Persistent TypeScript Server Daemon (Phase 7)
 * File: 2.body/diagnostics/daemon.ts
 *
 * Spawns the real `tsserver` binary (ships with the `typescript` package) and
 * speaks its JSON-over-stdio protocol:
 *   - `open`     — register a file with content (script-kind inferred)
 *   - `change`   — incremental full-content replace (same process, no restart)
 *   - `geterr`   — request syntactic + semantic diagnostics for a file set
 *   - `requestCompleted` — event that signals a geterr pass finished
 *
 * Diagnostics arrive as `semanticDiag` / `syntacticDiag` events and are fanned
 * out to subscribers (<50ms target for a single-file edit pass on a warm
 * server). Degrades cleanly when the binary is missing: `start()` returns
 * false and callers keep their compiler fallback.
 * =============================================================================
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { extname } from 'node:path';

export interface DiagnosticSpan {
  line: number;
  offset: number;
}

export interface DiagnosticEntry {
  file: string;
  start: DiagnosticSpan | null;
  end: DiagnosticSpan | null;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  code: number;
  message: string;
}

export interface DaemonOptions {
  /** Explicit path to tsserver; defaults to the installed typescript bin. */
  tsServerPath?: string;
  /** Working directory for the server (defaults to process.cwd()). Use an
   *  isolated directory to avoid attaching to a large host project. */
  cwd?: string;
  log?: (message: string) => void;
  /** Fan-out target for every diagnostics event. */
  onDiagnostics?: (file: string, diagnostics: DiagnosticEntry[]) => void;
  requestTimeoutMs?: number;
}

export interface DaemonStats {
  spawned: boolean;
  ready: boolean;
  requests: number;
  responses: number;
  events: number;
  openedFiles: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
}

interface PendingRequest {
  command: string;
  at: number;
  resolve: (body: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type DiagSubscriber = (file: string, diagnostics: DiagnosticEntry[]) => void;

const REQUEST_TIMEOUT_MS = 10_000;

export class TypeScriptServerDaemon {
  private proc: ChildProcess | null = null;
  private seq = 0;
  private pending = new Map<number, PendingRequest>();
  private completedRequests = new Set<number>();
  private completionWaiters = new Map<number, () => void>();
  private opened = new Set<string>();
  private buffer = '';
  private diagSubs = new Set<DiagSubscriber>();
  private latencies: number[] = [];
  private statsCounters = { requests: 0, responses: 0, events: 0 };
  private disposed = false;
  private requestTimeoutMs: number;

  constructor(private options: DaemonOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    if (options.onDiagnostics) this.diagSubs.add(options.onDiagnostics);
  }

  /** Subscribe to every diagnostics event fan-out. Returns an unsubscribe. */
  subscribeDiagnostics(cb: DiagSubscriber): () => void {
    this.diagSubs.add(cb);
    return () => this.diagSubs.delete(cb);
  }

  get ready(): boolean {
    return this.proc !== null && !this.disposed;
  }

  /** Spawn the server. Returns false when the binary is unavailable. */
  async start(): Promise<boolean> {
    if (this.ready) return true;
    const bin = this.resolveTsServerPath();
    if (!bin) {
      this.options.log?.('[tsdaemon] tsserver binary not found — compiler fallback will be used');
      return false;
    }
    try {
      this.proc = spawn(bin, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.cwd ?? process.cwd(),
      });
    } catch (error) {
      this.options.log?.(`[tsdaemon] spawn failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    this.proc.stdout!.setEncoding('utf8');
    this.proc.stdout!.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr!.on('data', () => {
      // tsserver logs noise here; ignored.
    });
    this.proc.on('error', (error) => {
      this.options.log?.(`[tsdaemon] process error: ${error.message}`);
      this.destroy();
    });
    this.proc.on('exit', () => {
      this.destroy();
    });

    return true;
  }

  /** Register a file with content. Already-open files are replaced in place
   *  with a single `change` (same process — no restart, no cold project). */
  async setFileContent(file: string, content: string): Promise<void> {
    this.assertReady();
    if (this.opened.has(file)) {
      const lines = content.split('\n');
      const lastLine = lines.length;
      const lastOffset = lines[lines.length - 1].length + 1;
      await this.request('change', { file, line: 1, offset: 1, endLine: lastLine, endOffset: lastOffset, insertString: content });
      return;
    }
    await this.request('open', { file, fileContent: content, scriptKindName: scriptKindFor(file) });
    this.opened.add(file);
  }

  /** Fire a geterr pass; diagnostics arrive via the event fan-out. geterr is
   *  fire-and-forget in the TS protocol — completion is the requestCompleted
   *  event, not a response. */
  async requestDiagnostics(files: string[], delay = 0): Promise<void> {
    this.assertReady();
    this.send('geterr', { delay, files });
  }

  /**
   * One-shot synchronous diagnostics for a single file: sets content, fires
   * geterr, and waits for the `requestCompleted` event so the returned array
   * is guaranteed complete (used by the healer's dependent-file pass).
   */
  async getDiagnostics(file: string, content: string, timeoutMs = 8_000): Promise<DiagnosticEntry[]> {
    this.assertReady();
    const collected: DiagnosticEntry[] = [];
    const sub: DiagSubscriber = (f, diags) => {
      if (f === file) collected.push(...diags);
    };
    this.diagSubs.add(sub);
    try {
      await this.setFileContent(file, content);
      const seq = this.send('geterr', { delay: 0, files: [file] });
      await this.waitForCompletion(seq, timeoutMs);
    } finally {
      this.diagSubs.delete(sub);
    }
    return collected;
  }

  async closeFile(file: string): Promise<void> {
    if (!this.ready || !this.opened.has(file)) return;
    try {
      await this.request('close', { file });
    } catch {
      // closing is best-effort
    }
    this.opened.delete(file);
  }

  async dispose(): Promise<void> {
    if (!this.proc) return;
    try {
      this.send('exit');
    } catch {
      // server may already be gone
    }
    // tsserver exits without a response — give it a beat, then force-clean.
    await new Promise((r) => setTimeout(r, 150));
    this.destroy();
  }

  getStats(): DaemonStats {
    const avg =
      this.latencies.length > 0
        ? this.latencies.reduce((acc, v) => acc + v, 0) / this.latencies.length
        : null;
    return {
      spawned: this.proc !== null,
      ready: this.ready,
      requests: this.statsCounters.requests,
      responses: this.statsCounters.responses,
      events: this.statsCounters.events,
      openedFiles: this.opened.size,
      lastLatencyMs: this.latencies.length > 0 ? this.latencies[this.latencies.length - 1] : null,
      avgLatencyMs: avg,
    };
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private assertReady(): void {
    if (!this.ready || !this.proc) throw new Error('TypeScriptServerDaemon is not started');
  }

  private resolveTsServerPath(): string | null {
    if (this.options.tsServerPath) return this.options.tsServerPath;
    try {
      const require = createRequire(import.meta.url);
      return require.resolve('typescript/bin/tsserver');
    } catch {
      return null;
    }
  }

  /** Write a request and return its seq (no response tracking — for
   *  fire-and-forget commands like geterr). */
  private send(command: string, args?: unknown): number {
    if (!this.proc || !this.proc.stdin) throw new Error('TypeScriptServerDaemon is not started');
    const seq = ++this.seq;
    this.statsCounters.requests++;
    this.proc.stdin.write(`${JSON.stringify({ seq, type: 'request', command, arguments: args })}\n`);
    return seq;
  }

  private request<T>(command: string, args: unknown, timeoutMs = this.requestTimeoutMs): Promise<{ seq: number; body: T }> {
    return new Promise((resolve, reject) => {
      const seq = this.send(command, args);
      const timer = setTimeout(() => {
        const req = this.pending.get(seq);
        if (req) {
          this.pending.delete(seq);
          req.reject(new Error(`tsserver request timeout: ${command}`));
        }
      }, timeoutMs);
      this.pending.set(seq, {
        command,
        at: Date.now(),
        resolve: (body) => resolve({ seq, body: body as T }),
        reject,
        timer,
      });
    });
  }

  private waitForCompletion(requestSeq: number, timeoutMs: number): Promise<void> {
    if (this.completedRequests.has(requestSeq)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.completionWaiters.delete(requestSeq);
        reject(new Error(`tsserver requestCompleted timeout (seq ${requestSeq})`));
      }, timeoutMs);
      this.completionWaiters.set(requestSeq, () => {
        clearTimeout(timer);
        this.completionWaiters.delete(requestSeq);
        resolve();
      });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    this.drain();
  }

  /**
   * tsserver frames stdout messages with LSP-style `Content-Length:` headers;
   * older builds emit bare newline-delimited JSON. Support both.
   */
  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.slice(0, headerEnd));
        if (match) {
          const length = Number(match[1]);
          const bodyStart = headerEnd + 4;
          if (this.buffer.length < bodyStart + length) break; // incomplete body
          const raw = this.buffer.slice(bodyStart, bodyStart + length);
          this.buffer = this.buffer.slice(bodyStart + length);
          this.consume(raw);
          continue;
        }
        // Header present but not Content-Length — drop it.
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      // No framing header yet — fall back to newline-delimited JSON lines.
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) break;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length > 0) this.consume(line);
    }
  }

  private consume(raw: string): void {
    try {
      this.handleMessage(JSON.parse(raw));
    } catch {
      // malformed / non-JSON frame — ignore
    }
  }

  private handleMessage(msg: { type?: string } & Record<string, unknown>): void {
    if (msg.type === 'response') {
      this.statsCounters.responses++;
      const requestSeq = (msg.request_seq as number) ?? (msg.seq as number);
      const req = this.pending.get(requestSeq);
      if (!req) return;
      clearTimeout(req.timer);
      this.pending.delete(requestSeq);
      this.latencies.push(Date.now() - req.at);
      if (this.latencies.length > 200) this.latencies.shift();
      if (msg.success === true) {
        req.resolve(msg.body);
      } else {
        req.reject(new Error(`tsserver ${req.command} failed: ${String(msg.message ?? 'unknown error')}`));
      }
      return;
    }

    if (msg.type === 'event') {
      this.statsCounters.events++;
      const event = String(msg.event ?? '');
      const body = (msg.body ?? {}) as Record<string, unknown>;
      if (event === 'semanticDiag' || event === 'syntacticDiag' || event === 'syntaxDiag' || event === 'suggestionDiag') {
        const file = String(body.file ?? '');
        const rawDiags = Array.isArray(body.diagnostics) ? body.diagnostics : [];
        const diags = rawDiags.map((d) => this.mapDiagnostic(file, d as Record<string, unknown>));
        this.emitDiagnostics(file, diags);
      } else if (event === 'requestCompleted') {
        const requestSeq = (body.request_seq as number) ?? -1;
        this.completedRequests.add(requestSeq);
        const waiter = this.completionWaiters.get(requestSeq);
        if (waiter) waiter();
      }
    }
  }

  private mapDiagnostic(file: string, d: Record<string, unknown>): DiagnosticEntry {
    const span = (v: unknown): DiagnosticSpan | null => {
      if (v && typeof v === 'object') {
        const line = Number((v as Record<string, unknown>).line ?? 0);
        const offset = Number((v as Record<string, unknown>).offset ?? 0);
        if (line > 0) return { line, offset };
      }
      return null;
    };
    const message = String(d.message ?? '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .trim();
    return {
      file,
      start: span(d.start),
      end: span(d.end),
      category: (['error', 'warning', 'suggestion', 'message'].includes(String(d.category))
        ? String(d.category)
        : 'message') as DiagnosticEntry['category'],
      code: Number(d.code ?? 0),
      message,
    };
  }

  private emitDiagnostics(file: string, diagnostics: DiagnosticEntry[]): void {
    for (const sub of Array.from(this.diagSubs)) {
      try {
        sub(file, diagnostics);
      } catch {
        // subscriber errors must not break the daemon
      }
    }
  }

  private destroy(): void {
    this.disposed = true;
    for (const [seq, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error('tsserver terminated'));
      this.pending.delete(seq);
    }
    this.proc?.stdin?.destroy();
    this.proc?.kill();
    this.proc = null;
  }
}

function scriptKindFor(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.tsx') return 'TSX';
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'TS';
  if (ext === '.jsx') return 'JSX';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'JS';
  if (ext === '.json') return 'JSON';
  return 'PlainText';
}

export default TypeScriptServerDaemon;
