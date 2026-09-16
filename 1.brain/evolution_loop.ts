// =============================================================================
// KLYN AI OS — 1.brain — Autonomous Self-Evolution Loop (Phase 7)
// File: 1.brain/evolution_loop.ts
//
// Phase 7 capability #4. The CLOSED LOOP that makes the OS self-evolving:
//
//   ingest(scope, key, success, latencyMs?)   — any producer feeds outcomes
//   tick()                                    — one loop pass:
//                                                 1. flush experiences into the
//                                                    learner (bounded queue)
//                                                 2. feed 'patch' outcomes into
//                                                    the policy regression guard
//                                                 3. every N ticks, propose +
//                                                    activate a policy candidate
//                                                    synthesized from learned
//                                                    stats (Merkle-signed)
//                                                 4. sweep the fleet (death,
//                                                    quarantine, rebalance)
//   start(intervalMs) / stop()                — non-blocking background loop
//                                               (unref'd, like the fuzzer)
//
// Everything is bounded (experience queue cap, proposal cadence, fleet table
// cap) and deterministic (proposal is a pure function of learner state; the
// regression guard rolls back on measured evidence — never on vibes).
//
// The loop is the wiring point for the full autonomous cycle:
//   fuzzer findings / LSP diagnostics / patch outcomes → experiences
//   → learner aggregates → policy candidate (signed) → activation
//   → guarded by rolling health → fleet rebalancing around failures.
// =============================================================================
import { EventBus, type KlynEvent } from '../packages/core-runtime/src/EventBus.js';
import { ExperienceLearner, type Experience } from './experience_learner.js';
import { AdaptivePolicyEngine, type PolicySnapshot } from './adaptive_policy.js';
import { FleetOrchestrator } from '../packages/swarm-mesh/src/fleet_orchestrator.js';

export interface EvolutionLoopOptions {
  bus?: EventBus;
  learner?: ExperienceLearner;
  policy?: AdaptivePolicyEngine;
  fleet?: FleetOrchestrator;
  /** Ticks between policy proposals (default 3). */
  proposeEvery?: number;
  /** Min 'patch' samples before the first proposal (default 8). */
  minSamplesToPropose?: number;
  /** Pending-experience queue cap (default 1024 — oldest dropped). */
  maxQueued?: number;
}

export interface EvolutionStats {
  ticks: number;
  queued: number;
  flushed: number;
  proposals: number;
  activations: number;
  rollbacks: number;
  policyVersion: number;
  healthyFleetNodes: number;
  fleetNodes: number;
}

const DEFAULT_PROPOSE_EVERY = 3;
const DEFAULT_MIN_SAMPLES_TO_PROPOSE = 8;
const DEFAULT_MAX_QUEUED = 1024;

export class EvolutionLoop {
  private bus: EventBus;
  private learner: ExperienceLearner;
  private policy: AdaptivePolicyEngine;
  private fleet: FleetOrchestrator;
  private queue: Experience[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly proposeEvery: number;
  private readonly minSamplesToPropose: number;
  private readonly maxQueued: number;
  private ticks = 0;
  private flushed = 0;
  private proposals = 0;
  private activations = 0;
  private rollbacks = 0;

  constructor(options: EvolutionLoopOptions = {}) {
    this.bus = options.bus ?? new EventBus();
    this.learner = options.learner ?? new ExperienceLearner({ bus: this.bus });
    // Idempotent: a learner already subscribed to this bus is left untouched.
    this.learner.subscribe(this.bus);
    this.policy = options.policy ?? new AdaptivePolicyEngine();
    this.fleet = options.fleet ?? new FleetOrchestrator({ bus: this.bus });
    this.proposeEvery = options.proposeEvery ?? DEFAULT_PROPOSE_EVERY;
    this.minSamplesToPropose = options.minSamplesToPropose ?? DEFAULT_MIN_SAMPLES_TO_PROPOSE;
    this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
  }

  // -------------------------------------------------------------------------
  // INGESTION
  // -------------------------------------------------------------------------

  /** Queue one outcome from any producer and publish it on the bus so the
   *  learner records it. Bounded: when the queue is full, the oldest pending
   *  experience is dropped (never unbounded memory). */
  ingest(scope: string, key: string, success: boolean, latencyMs?: number, detail?: string): void {
    const experience: Experience = { scope, key, success, latencyMs, detail, at: Date.now() };
    this.queue.push(experience);
    if (this.queue.length > this.maxQueued) {
      this.queue = this.queue.slice(-this.maxQueued);
    }
    this.bus.publish({ type: 'experience', payload: { scope, key, success, latencyMs, detail }, timestamp: experience.at } satisfies KlynEvent);
  }

  // -------------------------------------------------------------------------
  // THE LOOP
  // -------------------------------------------------------------------------

  /** One closed-loop pass. Fully synchronous except for nothing — all four
   *  stages are in-memory and deterministic. Safe to call on a timer. */
  tick(): void {
    this.ticks++;

    // 1. Flush pending experiences into the learner; feed 'patch' outcomes to
    //    the policy regression guard.
    while (this.queue.length > 0) {
      const experience = this.queue.shift()!;
      this.flushed++;
      if (experience.scope === 'patch') {
        const result = this.policy.observe(experience.success, experience.latencyMs);
        if (result.rolledBack) this.rollbacks++;
      }
    }

    // 2. Propose + activate a policy candidate on cadence (only when enough
    //    evidence has accumulated — never on an empty learner).
    if (this.ticks % this.proposeEvery === 0) {
      const patch = this.learner.query('patch');
      if (patch && patch.samples >= this.minSamplesToPropose) {
        this.proposals++;
        const draft = this.policy.proposeFromLearner(this.learner);
        if (!this.isNoopDraft(draft)) {
          const result = this.policy.activate(draft);
          if (result.ok) this.activations++;
        }
      }
    }

    // 3. Fleet supervision sweep + rebalance signals.
    this.fleet.tick();
    this.fleet.rebalance();
  }

  /** Start the continuous background loop (unref'd — never holds the process
   *  open). Interval defaults to 5s between passes. */
  start(intervalMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch {
        // a supervision pass must never crash the process
      }
    }, intervalMs);
    this.timer.unref?.();
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

  getStats(): EvolutionStats {
    const fleetStats = this.fleet.stats();
    return {
      ticks: this.ticks,
      queued: this.queue.length,
      flushed: this.flushed,
      proposals: this.proposals,
      activations: this.activations,
      rollbacks: this.rollbacks,
      policyVersion: this.policy.activeVersion,
      healthyFleetNodes: fleetStats.healthy,
      fleetNodes: fleetStats.nodes,
    };
  }

  get learnerState(): ExperienceLearner {
    return this.learner;
  }

  get policyState(): AdaptivePolicyEngine {
    return this.policy;
  }

  get fleetState(): FleetOrchestrator {
    return this.fleet;
  }

  /** Drain any pending queue without touching the loop counters (used before
   *  asserting learner state in tests). */
  flush(): void {
    while (this.queue.length > 0) {
      const experience = this.queue.shift()!;
      if (experience.scope === 'patch') {
        const result = this.policy.observe(experience.success, experience.latencyMs);
        if (result.rolledBack) this.rollbacks++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private isNoopDraft(draft: PolicySnapshot): boolean {
    const active = this.policy.active;
    return JSON.stringify(draft.rules) === JSON.stringify(active.rules);
  }
}

export default EvolutionLoop;
