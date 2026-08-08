// =============================================================================
// KLYN AI OS — Command Plan Cache (Phase 2)
// File: 2.body/pool/plan-cache.ts
//
// Deterministic hash dedup for VERIFIED PURE commands. A "pure" command is one
// the caller has explicitly flagged cacheable (no side effects worth re-running,
// e.g. read-only inspections). Identical (command, cwd, env) tuples hit the
// cache and skip shell execution entirely.
//
// Safety: only successful results are stored; results expire after `ttlMs`;
// the cache is bounded to `maxEntries` with oldest-first eviction.
// =============================================================================

import { createHash } from 'node:crypto';

export interface CommandPlan {
  key: string;
  command: string;
  cwd: string;
  envKey: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  createdAt: number;
  hitCount: number;
}

export interface PlanCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
}

const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_TTL_MS = 60_000;

export class CommandPlanCache {
  private maxEntries: number;
  private ttlMs: number;
  private plans = new Map<string, CommandPlan>();

  constructor(options: PlanCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Deterministic key over (command, cwd, env). */
  key(command: string, cwd: string, env?: Record<string, string>): string {
    const envKey = env
      ? JSON.stringify(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : 1)))
      : '';
    return createHash('sha256').update(JSON.stringify([command, cwd, envKey])).digest('hex');
  }

  /** Lookup a plan. Returns undefined on miss or TTL expiry. */
  get(key: string): CommandPlan | undefined {
    const plan = this.plans.get(key);
    if (!plan) return undefined;

    if (Date.now() - plan.createdAt > this.ttlMs) {
      this.plans.delete(key);
      return undefined;
    }

    plan.hitCount++;
    return plan;
  }

  /** Store a successful result for a verified pure command. */
  set(plan: CommandPlan): void {
    if (plan.exitCode !== 0) return; // never cache failures
    if (this.plans.has(plan.key)) return;

    if (this.plans.size >= this.maxEntries) {
      // Evict the oldest entry.
      let oldestKey: string | null = null;
      let oldestTs = Number.MAX_SAFE_INTEGER;
      for (const [k, p] of this.plans) {
        if (p.createdAt < oldestTs) {
          oldestTs = p.createdAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.plans.delete(oldestKey);
    }

    this.plans.set(plan.key, plan);
  }

  getStats(): { size: number; maxEntries: number; ttlMs: number; totalHits: number } {
    let totalHits = 0;
    for (const p of this.plans.values()) totalHits += p.hitCount;
    return { size: this.plans.size, maxEntries: this.maxEntries, ttlMs: this.ttlMs, totalHits };
  }

  clear(): void {
    this.plans.clear();
  }
}

export default CommandPlanCache;
