// =============================================================================
// KLYN AI OS — 1.brain — Operational Experience Learner (Phase 7)
// File: 1.brain/experience_learner.ts
//
// Phase 7 capability #1. The sensing half of the closed learning loop. Every
// operational outcome — patch applied/failed, fuzzer finding, cascade route
// decision, fleet heartbeat/error, swarm epoch result — is recorded as an
// EXPERIENCE and distilled into bounded, queryable aggregates:
//
//   learner.record(scope, key, success, latencyMs?)   — direct recording
//   learner.subscribe(bus)                            — records 'experience'
//                                                       events from any producer
//   learner.query(scope, key?)                        — per-key or merged stats
//   learner.top(scope, limit)                         — worst keys by failure
//   learner.summarize()                               — whole-memory snapshot
//
// Memory is bounded by construction: the experience ring buffer is capped
// (oldest evicted first) and the key table is capped (least-recently-recorded
// key evicted). Aggregates are pure functions of the recorded samples — no
// hidden state, no I/O, no blocking — so the learner is trivially safe to run
// inside the event loop and deterministic across identical input streams.
// =============================================================================
import type { EventBus, KlynEvent } from '../packages/core-runtime/src/EventBus.js';

export interface Experience {
  scope: string;
  key: string;
  success: boolean;
  latencyMs?: number;
  detail?: string;
  at: number;
}

export interface ExperienceStats {
  scope: string;
  key: string;
  samples: number;
  successes: number;
  failures: number;
  /** successes / samples (0 when no samples yet). */
  successRate: number;
  totalLatencyMs: number;
  /** totalLatencyMs / samples (0 when no samples yet). */
  avgLatencyMs: number;
  lastAt: number;
  /** 0..1 — how much statistical weight the sample count carries. */
  confidence: number;
}

export interface LearnerOptions {
  /** Experience ring-buffer cap (default 4096 — oldest evicted first). */
  maxExperiences?: number;
  /** Distinct (scope,key) table cap (default 2048 — LRU-key evicted). */
  maxKeys?: number;
  /** Sample count at which confidence reaches 1.0 (default 50). */
  fullConfidenceSamples?: number;
  bus?: EventBus;
}

interface KeyAgg {
  scope: string;
  key: string;
  samples: number;
  successes: number;
  failures: number;
  latencySum: number;
  lastAt: number;
}

const DEFAULT_MAX_EXPERIENCES = 4096;
const DEFAULT_MAX_KEYS = 2048;
const DEFAULT_FULL_CONFIDENCE = 50;

export class ExperienceLearner {
  private readonly maxExperiences: number;
  private readonly maxKeys: number;
  private readonly fullConfidenceSamples: number;
  private ring: Experience[] = [];
  private agg = new Map<string, KeyAgg>();
  private bus?: EventBus;
  private unsubscribeBus?: () => void;

  constructor(options: LearnerOptions = {}) {
    this.maxExperiences = options.maxExperiences ?? DEFAULT_MAX_EXPERIENCES;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.fullConfidenceSamples = options.fullConfidenceSamples ?? DEFAULT_FULL_CONFIDENCE;
    if (options.bus) this.subscribe(options.bus);
  }

  /** Record one experience. Synchronous, O(1) amortized, bounded memory. */
  record(scope: string, key: string, success: boolean, latencyMs?: number, detail?: string): Experience {
    const experience: Experience = {
      scope,
      key,
      success,
      latencyMs: typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : undefined,
      detail,
      at: Date.now(),
    };
    this.ring.push(experience);
    if (this.ring.length > this.maxExperiences) {
      this.ring = this.ring.slice(-this.maxExperiences);
    }

    const aggKey = `${scope}\u0000${key}`;
    let entry = this.agg.get(aggKey);
    if (!entry) {
      if (this.agg.size >= this.maxKeys) this.evictLeastRecent();
      entry = { scope, key, samples: 0, successes: 0, failures: 0, latencySum: 0, lastAt: 0 };
      this.agg.set(aggKey, entry);
    }
    entry.samples++;
    if (success) entry.successes++;
    else entry.failures++;
    if (experience.latencyMs !== undefined) entry.latencySum += experience.latencyMs;
    entry.lastAt = experience.at;
    return experience;
  }

  /** Record from a bus event: payload must carry { scope, key, success }
   *  and optionally { latencyMs, detail }. Non-matching events are ignored. */
  recordFromEvent(event: KlynEvent): Experience | null {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.scope !== 'string' || typeof payload.key !== 'string' || typeof payload.success !== 'boolean') {
      return null;
    }
    return this.record(
      payload.scope,
      payload.key,
      payload.success,
      typeof payload.latencyMs === 'number' ? payload.latencyMs : undefined,
      typeof payload.detail === 'string' ? payload.detail : undefined
    );
  }

  /** Subscribe to 'experience' events on a bus. Idempotent — returns an
   *  unsubscribe for the caller that owns the bus lifecycle. */
  subscribe(bus: EventBus): () => void {
    if (this.bus === bus) return this.unsubscribeBus ?? (() => undefined);
    this.unsubscribeBus?.();
    this.bus = bus;
    this.unsubscribeBus = bus.subscribe('experience', (event) => this.recordFromEvent(event));
    return this.unsubscribeBus;
  }

  /** Query aggregates for one (scope, key) — or merged across all keys of a
   *  scope when `key` is omitted. Deterministic, read-only. */
  query(scope: string, key?: string): ExperienceStats | null {
    const entries: KeyAgg[] = [];
    for (const entry of this.agg.values()) {
      if (entry.scope !== scope) continue;
      if (key !== undefined && entry.key !== key) continue;
      entries.push(entry);
    }
    if (entries.length === 0) return null;
    if (key !== undefined && entries.length === 1) return this.toStats(entries[0]);
    const merged: KeyAgg = {
      scope,
      key: key ?? '*',
      samples: 0,
      successes: 0,
      failures: 0,
      latencySum: 0,
      lastAt: 0,
    };
    for (const entry of entries) {
      merged.samples += entry.samples;
      merged.successes += entry.successes;
      merged.failures += entry.failures;
      merged.latencySum += entry.latencySum;
      if (entry.lastAt > merged.lastAt) merged.lastAt = entry.lastAt;
    }
    return this.toStats(merged);
  }

  /** The worst keys of a scope by failure rate (deterministic tie-breaks:
   *  more samples first, then lexicographic key). */
  top(scope: string, limit = 5): ExperienceStats[] {
    const rows: ExperienceStats[] = [];
    for (const entry of this.agg.values()) {
      if (entry.scope !== scope) continue;
      rows.push(this.toStats(entry));
    }
    rows.sort((a, b) => {
      const fa = a.samples > 0 ? a.failures / a.samples : 0;
      const fb = b.samples > 0 ? b.failures / b.samples : 0;
      if (fa !== fb) return fb - fa;
      if (a.samples !== b.samples) return b.samples - a.samples;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    return rows.slice(0, limit);
  }

  /** Whole-memory snapshot: per-scope merged stats + raw sample counts. */
  summarize(): { scopes: Record<string, ExperienceStats>; experiences: number; keys: number } {
    const scopes: Record<string, ExperienceStats> = {};
    const seen = new Set<string>();
    for (const entry of this.agg.values()) {
      if (seen.has(entry.scope)) continue;
      seen.add(entry.scope);
      const stats = this.query(entry.scope);
      if (stats) scopes[entry.scope] = stats;
    }
    return { scopes, experiences: this.ring.length, keys: this.agg.size };
  }

  /** Recent raw experiences (read-only, newest last, bounded by cap). */
  recent(limit = 20): Experience[] {
    return this.ring.slice(-limit).map((e) => ({ ...e }));
  }

  /** Drop all recorded memory (used by tests and fleet resets). */
  reset(): void {
    this.ring = [];
    this.agg.clear();
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private toStats(entry: KeyAgg): ExperienceStats {
    const samples = entry.samples;
    return {
      scope: entry.scope,
      key: entry.key,
      samples,
      successes: entry.successes,
      failures: entry.failures,
      successRate: samples > 0 ? entry.successes / samples : 0,
      totalLatencyMs: entry.latencySum,
      avgLatencyMs: samples > 0 ? entry.latencySum / samples : 0,
      lastAt: entry.lastAt,
      confidence: Math.min(1, samples / this.fullConfidenceSamples),
    };
  }

  /** Evict the least-recently-recorded key (deterministic: lowest lastAt,
   *  then lexicographic key). */
  private evictLeastRecent(): void {
    let worst: KeyAgg | null = null;
    for (const entry of this.agg.values()) {
      if (!worst || entry.lastAt < worst.lastAt || (entry.lastAt === worst.lastAt && entry.key < worst.key)) {
        worst = entry;
      }
    }
    if (worst) this.agg.delete(`${worst.scope}\u0000${worst.key}`);
  }
}

export default ExperienceLearner;
