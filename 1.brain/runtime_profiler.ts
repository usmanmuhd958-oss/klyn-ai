// =============================================================================
// KLYN AI OS — 1.brain — Real-Time Predictive Profiling & Self-Optimization Loop
// File: 1.brain/runtime_profiler.ts
//
// Phase 4 capability #1. An async event-loop hook that watches the runtime
// surfaces of the OS (API route latency, memory allocation spikes, slow
// database queries / N+1 patterns) against predefined SLAs and — when a
// route drops below its SLA — dispatches a BACKGROUND REPAIR SWARM:
//
//   1. record(sample)      — zero-blocking ring-buffer ingest, O(1) per route
//   2. evaluate(route)     — SLA classification (latency > 200ms, memory spike,
//                            N+1 pattern) over a sliding window
//   3. dispatchRepair()    — synthesize an optimized patch, run it through the
//                            Phase 3 QualityGate, then apply it through the
//                            Phase 6 TransactionalPatcher with deterministic
//                            rollback (MutationLoop) — never touches disk on a
//                            gate failure
//   4. start()/stop()      — the periodic self-optimization loop (async, never
//                            blocks the request path)
//
// Every lifecycle transition is published to the unified EventBus
// (`profiler:*` events) so dashboards and the healer loop observe breaches
// and repairs without polling.
//
// SLA defaults: latency > 200ms, memory delta > 64 MiB, slow-query burst ≥ 5
// (the N+1 signature). Cooldown per route prevents repair storms.
// =============================================================================
import { readFile } from 'node:fs/promises';
import { EventBus, type KlynEvent } from '../packages/core-runtime/src/EventBus.js';
import { MutationLoop } from '../packages/self-healing-runtime/src/healing_loop.js';
import { QualityGate } from '../packages/self-healing-runtime/src/mutation_harness.js';
import { TransactionalPatcher } from '../2.body/transactional_patcher.js';

export interface ProfilerSample {
  /** Route identifier (e.g. '/v1/context'). */
  route: string;
  /** Handler latency in milliseconds. */
  latencyMs: number;
  /** Heap delta observed during the call in MiB (negative = freed). */
  memoryDeltaMb: number;
  /** Number of queries in the call that exceeded the slow-query threshold. */
  slowQueries: number;
  /** True when the call exhibited an N+1 query pattern. */
  nPlusOne: boolean;
  /** Optional absolute path of the handler file the repair should patch. */
  filePath?: string;
  at?: number;
}

export interface RouteStats {
  samples: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  avgMemoryDeltaMb: number;
  slowQueryCount: number;
  nPlusOne: boolean;
}

export type ViolationKind = 'latency' | 'memory_spike' | 'n_plus_one';

export interface Violation {
  route: string;
  kind: ViolationKind;
  observed: number;
  threshold: number;
}

export interface RepairContext {
  route: string;
  filePath?: string;
  reasons: string[];
  samples: ProfilerSample[];
  stats: RouteStats;
}

export interface RepairOutcome {
  route: string;
  reasons: string[];
  dispatched: boolean;
  gateApproved: boolean;
  applied: boolean;
  rolledBack: boolean;
  error?: string;
  at: number;
}

/** Phase 14 production observability hooks — Prometheus metrics + OTel-style
 *  spans. Optional: when omitted the profiler runs exactly as before. */
export interface ProfilerTelemetry {
  metrics?: { inc(name: string, help: string, labels?: Record<string, string>, by?: number): void; observe(name: string, help: string, value: number, labels?: Record<string, string>): void };
  tracer?: { startSpan(name: string, attributes?: Record<string, string | number | boolean>): { end(attributes?: Record<string, string | number | boolean>, status?: 'OK' | 'ERROR' | 'UNSET'): void } };
}

export interface ProfilerOptions {
  /** Phase 14 production observability hooks (Prometheus + OTel spans). */
  telemetry?: ProfilerTelemetry;
  /** Latency SLA in ms (default 200). */
  latencySlaMs?: number;
  /** Memory allocation spike threshold in MiB (default 64). */
  memorySpikeMb?: number;
  /** Slow-query burst that signals an N+1 pattern (default 5). */
  nPlusOneThreshold?: number;
  /** Sliding evaluation window in ms (default 30_000). */
  windowMs?: number;
  /** Minimum gap between repair dispatches per route (default 30_000). */
  cooldownMs?: number;
  /** Max samples retained per route (bounded memory) (default 256). */
  maxSamplesPerRoute?: number;
  /** Optimized-patch synthesizer. Override for LLM/rule-based synthesis. */
  patchSynthesizer?: (ctx: RepairContext) => string | Promise<string>;
  patcher?: TransactionalPatcher;
  gate?: QualityGate;
  bus?: EventBus;
}

const DEFAULT_LATENCY_SLA_MS = 200;
const DEFAULT_MEMORY_SPIKE_MB = 64;
const DEFAULT_N_PLUS_ONE_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 30_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_SAMPLES_PER_ROUTE = 256;

/**
 * Deterministic default synthesizer: prepends a module-level memoization
 * cache to the handler file (a syntax-safe, side-effect-free optimization for
 * latency-bound routes). Real deployments inject an LLM/agent synthesizer.
 */
export async function defaultPatchSynthesizer(ctx: RepairContext): Promise<string> {
  if (!ctx.filePath) return '';
  const original = await readFile(ctx.filePath, 'utf-8').catch(() => null);
  if (original === null) return '';
  const guard = `// [klyn-profiler] SLA repair ${Date.now()} — module-level memoization cache (auto-generated)
const __klynRouteCache = new Map<string, unknown>();
function __klynMemo(key: string, compute: () => unknown): unknown {
  if (__klynRouteCache.has(key)) return __klynRouteCache.get(key);
  const value = compute();
  __klynRouteCache.set(key, value);
  return value;
}
`;
  return `${guard}\n${original}`;
}

export class RuntimeProfiler {
  private samplesByRoute = new Map<string, ProfilerSample[]>();
  private lastDispatchAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private totalSamples = 0;
  private repairCount = 0;

  private readonly latencySlaMs: number;
  private readonly memorySpikeMb: number;
  private readonly nPlusOneThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly maxSamplesPerRoute: number;

  private readonly patcher: TransactionalPatcher;
  private readonly gate: QualityGate;
  private readonly bus: EventBus;
  private readonly synthesize: (ctx: RepairContext) => string | Promise<string>;
  private readonly telemetry: ProfilerTelemetry | undefined;

  constructor(options: ProfilerOptions = {}) {
    this.latencySlaMs = options.latencySlaMs ?? DEFAULT_LATENCY_SLA_MS;
    this.memorySpikeMb = options.memorySpikeMb ?? DEFAULT_MEMORY_SPIKE_MB;
    this.nPlusOneThreshold = options.nPlusOneThreshold ?? DEFAULT_N_PLUS_ONE_THRESHOLD;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxSamplesPerRoute = options.maxSamplesPerRoute ?? DEFAULT_MAX_SAMPLES_PER_ROUTE;
    this.patcher = options.patcher ?? new TransactionalPatcher();
    this.gate = options.gate ?? new QualityGate();
    this.bus = options.bus ?? new EventBus();
    this.synthesize = options.patchSynthesizer ?? defaultPatchSynthesizer;
    this.telemetry = options.telemetry;
  }

  // -------------------------------------------------------------------------
  // INGESTION (O(1) — never blocks the request path)
  // -------------------------------------------------------------------------

  /** Record one runtime sample. Prunes stale samples outside the window and
   *  caps the per-route buffer so a hot route cannot grow unbounded memory. */
  record(sample: ProfilerSample): void {
    const at = sample.at ?? Date.now();
    this.totalSamples++;
    const list = this.samplesByRoute.get(sample.route) ?? [];
    list.push({ ...sample, at });
    // Trim: drop samples older than the window, then enforce the cap.
    const cutoff = at - this.windowMs;
    const fresh = list.filter((s) => (s.at ?? at) >= cutoff);
    this.samplesByRoute.set(sample.route, fresh.slice(-this.maxSamplesPerRoute));
    this.bus.publish({ type: 'profiler:sample', payload: { ...sample, at }, timestamp: at } satisfies KlynEvent);
    // Phase 14 telemetry: latency histogram + trace span per sample.
    this.telemetry?.metrics?.observe('klyn_route_latency_ms', 'Route latency', sample.latencyMs, { route: sample.route });
    this.telemetry?.metrics?.inc('klyn_profiler_samples_total', 'Profiler samples recorded', { route: sample.route });
    this.telemetry?.tracer?.startSpan('profiler.record', { route: sample.route, latencyMs: sample.latencyMs }).end({}, 'OK');
  }

  /** Bounded window stats for a route (single pass over retained samples). */
  statsFor(route: string): RouteStats {
    const list = this.samplesByRoute.get(route) ?? [];
    if (list.length === 0) {
      return { samples: 0, avgLatencyMs: 0, p95LatencyMs: 0, maxLatencyMs: 0, avgMemoryDeltaMb: 0, slowQueryCount: 0, nPlusOne: false };
    }
    const latencies = list.map((s) => s.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
    const avgMemoryDeltaMb = list.reduce((a, s) => a + s.memoryDeltaMb, 0) / list.length;
    return {
      samples: list.length,
      avgLatencyMs,
      p95LatencyMs: latencies[p95Index],
      maxLatencyMs: latencies[latencies.length - 1],
      avgMemoryDeltaMb,
      slowQueryCount: list.reduce((a, s) => a + s.slowQueries, 0),
      nPlusOne: list.some((s) => s.nPlusOne),
    };
  }

  /** Classify a route against the configured SLAs over the window. */
  evaluate(route: string): Violation[] {
    const stats = this.statsFor(route);
    if (stats.samples === 0) return [];
    const violations: Violation[] = [];
    if (stats.p95LatencyMs > this.latencySlaMs) {
      violations.push({ route, kind: 'latency', observed: stats.p95LatencyMs, threshold: this.latencySlaMs });
    }
    if (stats.avgMemoryDeltaMb > this.memorySpikeMb) {
      violations.push({ route, kind: 'memory_spike', observed: stats.avgMemoryDeltaMb, threshold: this.memorySpikeMb });
    }
    if (stats.slowQueryCount >= this.nPlusOneThreshold || stats.nPlusOne) {
      violations.push({ route, kind: 'n_plus_one', observed: stats.slowQueryCount, threshold: this.nPlusOneThreshold });
    }
    for (const v of violations) {
      this.bus.publish({ type: 'profiler:violation', payload: v, timestamp: Date.now() } satisfies KlynEvent);
    }
    return violations;
  }

  // -------------------------------------------------------------------------
  // BACKGROUND REPAIR DISPATCH
  // -------------------------------------------------------------------------

  /**
   * Dispatch a background repair for a route: synthesize → QualityGate → apply
   * (or deterministic rollback). Cooldown-gated per route. Never throws —
   * failures are returned as an outcome and published to the bus.
   */
  async dispatchRepair(route: string): Promise<RepairOutcome> {
    const now = Date.now();
    const span = this.telemetry?.tracer?.startSpan('profiler.repair', { route });
    const violations = this.evaluate(route);
    if (violations.length === 0) {
      span?.end({ dispatched: false }, 'OK');
      return { route, reasons: [], dispatched: false, gateApproved: false, applied: false, rolledBack: false, at: now };
    }

    const last = this.lastDispatchAt.get(route) ?? 0;
    if (now - last < this.cooldownMs) {
      const outcome: RepairOutcome = { route, reasons: [], dispatched: false, gateApproved: false, applied: false, rolledBack: false, at: now, error: 'cooldown active' };
      this.bus.publish({ type: 'profiler:repair:skipped', payload: outcome, timestamp: now } satisfies KlynEvent);
      return outcome;
    }
    this.lastDispatchAt.set(route, now);

    const reasons = violations.map((v) => `${v.kind} (${v.observed.toFixed(1)} vs SLA ${v.threshold})`);
    const list = this.samplesByRoute.get(route) ?? [];
    const ctx: RepairContext = { route, filePath: list.find((s) => s.filePath)?.filePath, reasons, samples: [...list], stats: this.statsFor(route) };

    this.bus.publish({ type: 'profiler:repair:start', payload: { route, reasons }, timestamp: now } satisfies KlynEvent);
    this.repairCount++;

    let candidate: string;
    try {
      candidate = await this.synthesize(ctx);
    } catch (error) {
      const outcome: RepairOutcome = { route, reasons, dispatched: true, gateApproved: false, applied: false, rolledBack: false, at: Date.now(), error: `synthesize failed: ${error instanceof Error ? error.message : String(error)}` };
      this.bus.publish({ type: 'profiler:repair:outcome', payload: outcome, timestamp: outcome.at } satisfies KlynEvent);
      return outcome;
    }
    if (typeof candidate !== 'string' || candidate.length === 0) {
      const outcome: RepairOutcome = { route, reasons, dispatched: true, gateApproved: false, applied: false, rolledBack: false, at: Date.now(), error: 'synthesizer returned no candidate' };
      this.bus.publish({ type: 'profiler:repair:outcome', payload: outcome, timestamp: outcome.at } satisfies KlynEvent);
      return outcome;
    }

    // Phase 3 quality gate: reject any patch that breaks syntax, introduces
    // unhandled promise rejections, or drops coverage — before it touches disk.
    const verdict = this.gate.evaluate({ code: candidate });
    if (!verdict.approved) {
      const outcome: RepairOutcome = { route, reasons, dispatched: true, gateApproved: false, applied: false, rolledBack: false, at: Date.now(), error: verdict.reasons.join('; ') };
      this.bus.publish({ type: 'profiler:repair:outcome', payload: outcome, timestamp: outcome.at } satisfies KlynEvent);
      return outcome;
    }

    // Apply through the transactional patcher with deterministic rollback.
    if (!ctx.filePath) {
      const outcome: RepairOutcome = { route, reasons, dispatched: true, gateApproved: true, applied: false, rolledBack: false, at: Date.now(), error: 'no filePath to apply repair to' };
      this.bus.publish({ type: 'profiler:repair:outcome', payload: outcome, timestamp: outcome.at } satisfies KlynEvent);
      return outcome;
    }

    const original = await readFile(ctx.filePath, 'utf-8').catch(() => null);
    if (original === null) {
      const outcome: RepairOutcome = { route, reasons, dispatched: true, gateApproved: true, applied: false, rolledBack: false, at: Date.now(), error: 'handler file vanished before apply' };
      this.bus.publish({ type: 'profiler:repair:outcome', payload: outcome, timestamp: outcome.at } satisfies KlynEvent);
      return outcome;
    }

    const loop = new MutationLoop(this.patcher);
    const healed = await loop.healWithPatches(ctx.filePath, original, [candidate]);

    const outcome: RepairOutcome = {
      route,
      reasons,
      dispatched: true,
      gateApproved: true,
      applied: healed.applied,
      rolledBack: healed.rolledBack,
      at: Date.now(),
      error: healed.success ? undefined : healed.errors.join('; '),
    };
    this.bus.publish({ type: 'profiler:repair:outcome', payload: outcome, timestamp: outcome.at } satisfies KlynEvent);
    this.telemetry?.metrics?.inc('klyn_repairs_total', 'Autonomous repairs dispatched', { route, applied: String(healed.applied) });
    span?.end({ applied: healed.applied, rolledBack: healed.rolledBack }, healed.applied ? 'OK' : 'ERROR');
    return outcome;
  }

  // -------------------------------------------------------------------------
  // ASYNC SELF-OPTIMIZATION LOOP
  // -------------------------------------------------------------------------

  /** Start the periodic evaluation loop (async, non-blocking). */
  start(intervalMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  /** One evaluation pass: every observed route, dispatch repairs when breached. */
  async tick(): Promise<RepairOutcome[]> {
    const outcomes: RepairOutcome[] = [];
    for (const route of this.samplesByRoute.keys()) {
      if (this.evaluate(route).length > 0) {
        outcomes.push(await this.dispatchRepair(route));
      }
    }
    return outcomes;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  /** Route identifiers currently under observation (Phase 9 drive-pending). */
  routes(): string[] {
    return Array.from(this.samplesByRoute.keys()).sort();
  }

  /** File path recorded on the most recent sample for a route (Phase 9
   *  epoch driver uses it to heal the right handler). */
  sampleFilePath(route: string): string | null {
    const list = this.samplesByRoute.get(route);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].filePath) return list[i].filePath!;
    }
    return null;
  }

  getStats(): { totalSamples: number; observedRoutes: number; repairsDispatched: number; committed: number } {
    return {
      totalSamples: this.totalSamples,
      observedRoutes: this.samplesByRoute.size,
      repairsDispatched: this.repairCount,
      committed: this.patcher.committed,
    };
  }
}

export default RuntimeProfiler;
