/**
 * =============================================================================
 * KLYN AI OS — 2.body — Speculative Execution Pool (Phase 8)
 * File: 2.body/execution/spec_exec.ts
 *
 * Pre-executes would-be code states in a sandbox with ZERO side effects on
 * the working tree:
 *   - No shadow directories: the projection is compiled through a virtual
 *     TypeScript compiler host that serves projected content for touched
 *     files and falls back to read-only disk for everything else.
 *   - No shell, no spawned processes: in-process `ts.createProgram`.
 *   - Verdict cache keyed by the plan's deterministic `planHash` — the same
 *     mutation speculated twice is answered in O(1) with the cached verdict.
 *   - Epoch-based invalidation: bump the epoch after a real edit and all
 *     in-flight / cached speculation from the previous state is discarded.
 *   - Bounded worker pool (no unbounded parallelism).
 *
 * `routePrewarm()` wires a FutureSimulator's pre-warm signals directly into
 * the executor: predicted files get their candidate plans compiled before the
 * user finishes typing, so the verdict is already cached when the edit lands.
 * =============================================================================
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as ts from 'typescript';
import type { ExecPlan } from '../../1.brain/patch_planner.js';
import type { FutureSimulator, PreWarmSignal } from '../../world-model/prediction/FutureSimulator.js';

export interface SpecDiagnostic {
  file: string;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  code: number;
  message: string;
  line?: number;
}

export interface SpeculativeVerdict {
  planHash: string;
  /** True when the projected state compiles with no error diagnostics. */
  ok: boolean;
  diagnostics: SpecDiagnostic[];
  durationMs: number;
  /** Epoch at verdict time — stale after the executor's epoch is bumped. */
  epoch: number;
  cached: boolean;
}

export interface SpeculativeExecutorOptions {
  /** Max concurrent compiles (default 2). */
  concurrency?: number;
  /** Verdict cache TTL in ms (default 60s). */
  cacheTtlMs?: number;
  /** Max cached verdicts (default 256, LRU-evicted). */
  maxCacheEntries?: number;
  /** Explicit tsconfig path; defaults to <repoRoot>/tsconfig.json. */
  tsconfigPath?: string;
}

export interface PrewarmRouterOptions {
  repoRoot?: string;
  /** Only speculate signals at/above this confidence (default 0). */
  minConfidence?: number;
}

/** Given a pre-warm signal, produce the candidate plan to pre-compile
 *  (null = nothing to speculate for this signal). */
export type PrewarmPlanProvider = (signal: PreWarmSignal) => ExecPlan | null | Promise<ExecPlan | null>;

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 256;

interface PendingSpec {
  plan: ExecPlan;
  repoRoot: string;
  resolve: (verdict: SpeculativeVerdict) => void;
}

/**
 * Compile a set of projected files through a virtual compiler host.
 * Projected files are served from memory; every other file (imports,
 * libs, tsconfig) is read from disk read-only. Never writes anything.
 */
export function compileProjection(projected: Map<string, string>, repoRoot: string, tsconfigPath?: string): SpecDiagnostic[] {
  const roots = [...projected.keys()];
  if (roots.length === 0) return [];

  const configPath = tsconfigPath ?? join(repoRoot, 'tsconfig.json');
  const baseOptions: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true,
  };
  let options = baseOptions;
  if (ts.sys.fileExists(configPath)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot);
      options = { ...baseOptions, ...parsed.options, noEmit: true, skipLibCheck: true };
    }
  }

  const host = ts.createCompilerHost(options);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, langVersion, onError, shouldCreateNewSourceFile) => {
    const projectedContent = projected.get(fileName);
    if (projectedContent !== undefined) {
      return ts.createSourceFile(fileName, projectedContent, langVersion, true);
    }
    return defaultGetSourceFile(fileName, langVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (fileName) => (projected.has(fileName) ? true : defaultFileExists(fileName));
  host.readFile = (fileName) => (projected.has(fileName) ? projected.get(fileName)! : defaultReadFile(fileName));

  const program = ts.createProgram(roots, options, host);
  const raw = ts.getPreEmitDiagnostics(program);

  return raw.map((d) => {
    const file = d.file?.fileName ?? roots[0];
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    const category: SpecDiagnostic['category'] =
      d.category === ts.DiagnosticCategory.Error ? 'error'
      : d.category === ts.DiagnosticCategory.Warning ? 'warning'
      : d.category === ts.DiagnosticCategory.Suggestion ? 'suggestion'
      : 'message';
    return { file, category, code: d.code, message, line: pos ? pos.line + 1 : undefined };
  });
}

/** Bounded, epoch-aware speculative execution pool with a verdict cache. */
export class SpeculativeExecutor {
  private cache = new Map<string, { verdict: SpeculativeVerdict; at: number }>();
  private queue: PendingSpec[] = [];
  private running = 0;
  private epoch = 0;
  private hits = 0;
  private misses = 0;
  private readonly concurrency: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly tsconfigPath?: string;

  constructor(private options: SpeculativeExecutorOptions = {}) {
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_ENTRIES;
    this.tsconfigPath = options.tsconfigPath;
  }

  /** Bump the epoch — invalidates in-flight and cached speculation from the
   *  previous repository state. Returns the new epoch. */
  bumpEpoch(): number {
    this.epoch++;
    this.cache.clear();
    this.queue.length = 0;
    return this.epoch;
  }

  /** Speculate a candidate plan. O(1) cache hit on repeat mutations. */
  async speculate(plan: ExecPlan, repoRoot: string): Promise<SpeculativeVerdict> {
    const cached = this.cache.get(plan.planHash);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      this.hits++;
      return { ...cached.verdict, cached: true, epoch: this.epoch };
    }
    this.misses++;
    return this.enqueue(plan, repoRoot);
  }

  /** Deterministic hash for an op list (independent of the planner). */
  static hashOps(operations: Array<{ type: string; path: string; oldContent?: string; newContent?: string; content?: string }>): string {
    return createHash('sha256')
      .update(JSON.stringify(operations.map((o) => [o.type, o.path, o.oldContent ?? '', o.newContent ?? '', o.content ?? ''])))
      .digest('hex');
  }

  getStats(): { cacheSize: number; hits: number; misses: number; epoch: number; running: number; queueDepth: number } {
    return {
      cacheSize: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      epoch: this.epoch,
      running: this.running,
      queueDepth: this.queue.length,
    };
  }

  clear(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private enqueue(plan: ExecPlan, repoRoot: string): Promise<SpeculativeVerdict> {
    return new Promise((resolve) => {
      this.queue.push({ plan, repoRoot, resolve });
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const pending = this.queue.shift()!;
      this.running++;
      void this.run(pending).finally(() => {
        this.running--;
        this.drain();
      });
    }
  }

  private async run(pending: PendingSpec): Promise<void> {
    const t0 = performance.now();
    const diagnostics = compileProjection(pending.plan.projected, pending.repoRoot, this.tsconfigPath);
    const ok = !diagnostics.some((d) => d.category === 'error');
    const verdict: SpeculativeVerdict = {
      planHash: pending.plan.planHash,
      ok,
      diagnostics,
      durationMs: performance.now() - t0,
      epoch: this.epoch,
      cached: false,
    };
    this.cache.set(pending.plan.planHash, { verdict, at: Date.now() });
    if (this.cache.size > this.maxCacheEntries) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldest = key;
        }
      }
      if (oldest !== null) this.cache.delete(oldest);
    }
    pending.resolve(verdict);
  }
}

/**
 * Route a FutureSimulator's pre-warm signals directly into the executor:
 * predicted files get their candidate plans pre-compiled in the background,
 * so the verdict is cached before the edit lands. Returns a teardown that
 * unroutes the sink.
 */
export function routePrewarm(
  future: FutureSimulator,
  executor: SpeculativeExecutor,
  planProvider: PrewarmPlanProvider,
  options: PrewarmRouterOptions = {}
): () => void {
  const repoRoot = options.repoRoot ?? process.cwd();
  const minConfidence = options.minConfidence ?? 0;
  future.setPrewarmSink((signal) => {
    if (signal.confidence < minConfidence) return;
    void (async () => {
      try {
        const plan = await planProvider(signal);
        if (plan) await executor.speculate(plan, repoRoot);
      } catch {
        // speculation must never throw into the predictive loop
      }
    })();
  });
  return () => future.setPrewarmSink(null);
}

export default SpeculativeExecutor;
