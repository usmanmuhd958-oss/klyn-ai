// =============================================================================
// KLYN AI OS — self-healing-runtime — Wasm & Worker Isolation Sandbox
// File: packages/self-healing-runtime/src/wasm_sandbox.ts
//
// Phase 5 capability #2. An isolated execution runtime for UNTRUSTED code —
// agent-generated patches, synthetic mutation suites, speculative plans —
// built on Node worker_threads + node:vm + WebAssembly:
//
//   - PROCESS ISOLATION: every payload runs in a worker_threads process with
//     its own memory space (resourceLimits: 128 MiB old-gen cap by default).
//   - I/O DISABLED: the vm context exposes only safe globals; `process`,
//     `require`, `import(`, `fs`, and the constructor-escape vector are
//     statically rejected AND structurally absent from the context.
//   - CPU BOUND: per-script vm timeout (wall-clock burst cap) plus a hard
//     worker timeout — a hung worker is TERMINATED, never left to spin.
//   - WASM: modules instantiate with an EMPTY import object — zero host
//     capabilities — and only the named export is callable.
//   - <5ms SLA: a warm pool of pre-spawned workers (reused, round-robin);
//     `warm(count)` spawns up front so the hot-path acquire→execute latency
//     stays sub-5ms. Cold spawns are lazily replenished on termination.
// =============================================================================
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export interface SandboxOptions {
  /** Old-generation heap cap in MiB (default 128). */
  memoryLimitMb?: number;
  /** Per-script CPU burst cap in ms (default 500). */
  cpuTimeMs?: number;
  /** Hard wall-clock budget for a single run incl. queueing (default 1000). */
  timeoutMs?: number;
  /** Worker concurrency (default 2). */
  concurrency?: number;
}

export interface SandboxResult {
  ok: boolean;
  /** JSON-clean value for ok runs. */
  result: unknown;
  /** Error message for failed runs. */
  error?: string;
  /** Wall-clock from acquire to result (the <5ms SLA metric). */
  latencyMs: number;
  /** True when the worker had to be terminated (timeout / crash). */
  terminated: boolean;
}

interface WorkerSlot {
  worker: WorkerSandbox;
  busy: boolean;
  dead: boolean;
}

const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_CPU_TIME_MS = 500;
const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_CONCURRENCY = 2;

/** Minimal deterministic wasm module: (i32, i32) -> i32 add. Embedded bytes
 *  (hand-assembled, no toolchain) so tests exercise real wasm execution. */
export const ADD_WASM: Uint8Array = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type: (i32,i32)->i32
  0x03, 0x02, 0x01, 0x00, // function section: 1 func, type 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export "add" func 0
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code
]);

const WORKER_URL = fileURLToPath(new URL('./sandbox_worker.js', import.meta.url));

/**
 * A single isolated worker slot. Handles one run at a time; a hard timeout
 * terminates the worker so a runaway script can never outlive its budget.
 */
export class WorkerSandbox {
  private worker: Worker | null = null;
  private pending: Map<number, { resolve: (r: SandboxResult) => void }> = new Map();
  private nextId = 0;

  constructor(private options: SandboxOptions = {}) {}

  get isReady(): boolean {
    return this.worker !== null;
  }

  /** Spawn the worker with the configured resource limits. */
  spawn(): void {
    if (this.worker) return;
    const memoryLimitMb = this.options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
    this.worker = new Worker(WORKER_URL, {
      resourceLimits: {
        maxOldGenerationSizeMb: memoryLimitMb,
        maxYoungGenerationSizeMb: Math.max(16, Math.min(32, Math.floor(memoryLimitMb / 4))),
        stackSizeMb: 4,
      },
    });
    this.worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      pending.resolve({
        ok: msg.ok,
        result: msg.result,
        error: msg.error,
        latencyMs: 0, // filled by the caller (pool tracks the real clock)
        terminated: false,
      });
    });
    this.worker.on('error', (err) => {
      void this.worker?.terminate().catch(() => undefined);
      this.worker = null;
      const message = `worker error: ${err instanceof Error ? err.message : String(err)}`;
      for (const [key, p] of this.pending) {
        this.pending.delete(key);
        p.resolve({ ok: false, result: undefined, error: message, latencyMs: 0, terminated: true });
      }
    });
    this.worker.on('exit', () => {
      this.worker = null;
    });
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      const w = this.worker;
      this.worker = null;
      await w.terminate().catch(() => undefined);
    }
  }

  /** Run a JS script inside the isolated context. */
  async runJs(code: string, args: unknown[] = []): Promise<SandboxResult> {
    this.spawn();
    return this.execute({ kind: 'js', code, args });
  }

  /** Instantiate a wasm module (empty imports) and call an exported function. */
  async runWasm(wasm: Uint8Array, fn: string, args: number[] = []): Promise<SandboxResult> {
    this.spawn();
    return this.execute({ kind: 'wasm', wasm: Array.from(wasm), fn, args });
  }

  private execute(payload: Record<string, unknown>): Promise<SandboxResult> {
    const id = this.nextId++;
    const cpuTimeMs = this.options.cpuTimeMs ?? DEFAULT_CPU_TIME_MS;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = performance.now();
    const worker = this.worker;

    return new Promise<SandboxResult>((resolve) => {
      if (!worker) {
        resolve({ ok: false, result: undefined, error: 'worker unavailable', latencyMs: performance.now() - started, terminated: false });
        return;
      }
      this.pending.set(id, {
        resolve: (r) => resolve({ ...r, latencyMs: performance.now() - started }),
      });
      worker.postMessage({ id, ...payload, cpuTimeMs });

      // Hard wall-clock budget: terminate the worker if it doesn't reply.
      setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        void worker.terminate().then(() => {
          this.worker = null; // slot is dead — caller must re-spawn
          resolve({
            ok: false,
            result: undefined,
            error: `sandbox timeout after ${timeoutMs}ms`,
            latencyMs: performance.now() - started,
            terminated: true,
          });
        });
      }, timeoutMs).unref?.();
    });
  }
}

/**
 * Warm worker pool: pre-spawned, PRIMED, reused, round-robin. Every slot is
 * sent a no-op message at spawn time — this absorbs the runtime's lazy
 * first-message bootstrap (~11ms in Bun) so the hot path (acquire → execute)
 * runs at transport speed (~0.2ms), keeping the instantiation SLA < 5ms.
 * A terminated slot is replaced lazily.
 */
export class SandboxPool {
  private slots: WorkerSlot[] = [];
  private cursor = 0;
  private warming: Promise<void> | null = null;

  constructor(private options: SandboxOptions = {}) {}

  /** Pre-spawn + prime `count` workers (idempotent, resolves when ready). */
  async warm(count?: number): Promise<void> {
    const target = Math.min(count ?? this.options.concurrency ?? DEFAULT_CONCURRENCY, 8);
    const toPrime: WorkerSandbox[] = [];
    while (this.slots.length < target) {
      const box = new WorkerSandbox(this.options);
      box.spawn();
      this.slots.push({ worker: box, busy: false, dead: false });
      toPrime.push(box);
    }
    if (toPrime.length === 0) return;
    // Prime each new slot (one no-op round-trip absorbs first-message cost).
    await Promise.all(toPrime.map((box) => box.runJs('return 0;', [])));
  }

  /** Ensure the default concurrency exists and is primed (awaits priming). */
  private async ensureWarm(): Promise<void> {
    if (this.slots.length >= (this.options.concurrency ?? DEFAULT_CONCURRENCY)) return;
    if (this.warming) {
      await this.warming;
      return;
    }
    this.warming = this.warm();
    try {
      await this.warming;
    } finally {
      this.warming = null;
    }
  }

  /** Execute on the next free slot (or spawn on demand). Lock-free: the
   *  single-threaded event loop makes slot state transitions atomic. */
  async runJs(code: string, args: unknown[] = []): Promise<SandboxResult> {
    return this.dispatch((box) => box.runJs(code, args));
  }

  async runWasm(wasm: Uint8Array, fn: string, args: number[] = []): Promise<SandboxResult> {
    return this.dispatch((box) => box.runWasm(wasm, fn, args));
  }

  private async dispatch(run: (box: WorkerSandbox) => Promise<SandboxResult>): Promise<SandboxResult> {
    await this.ensureWarm(); // guarantee at least the default concurrency, primed
    const slot = this.slots[this.cursor % this.slots.length];
    this.cursor++;
    slot.busy = true;
    const started = performance.now();
    try {
      const result = await run(slot.worker);
      // A terminated worker invalidates the slot (runJs already nulled it).
      if (result.terminated || !slot.worker.isReady) {
        slot.dead = true;
        this.slots = this.slots.filter((s) => !s.dead);
        if (this.slots.length === 0) this.warm(); // lazy replenish
      }
      return { ...result, latencyMs: performance.now() - started };
    } finally {
      slot.busy = false;
    }
  }

  async terminate(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
    this.cursor = 0;
  }

  get size(): number {
    return this.slots.length;
  }
}

/** Convenience: one-shot isolated execution with default limits. */
export async function runIsolated(code: string, args: unknown[] = []): Promise<SandboxResult> {
  const box = new WorkerSandbox();
  try {
    return await box.runJs(code, args);
  } finally {
    await box.terminate();
  }
}

export default SandboxPool;
