// =============================================================================
// KLYN AI OS — 1.brain — Multi-Agent Swarm Orchestrator (Phase 3)
// File: 1.brain/swarm/AgentOrchestrator.ts
//
// The non-blocking parallel execution coordinator for specialized agent roles
// (Architect, Code Modder, Security Auditor, Test Generator). It composes the
// existing fork-based consensus swarm (AgentSwarm) with:
//
//   - STRICT EXECUTION TIMEOUTS: every epoch runs under a hard budget
//     (default 5s). A timed-out epoch is marked `timed_out`, its abort signal
//     is set, and the in-flight epoch rolls back at its commit checkpoint —
//     a timed-out epoch NEVER writes files.
//   - UNIFIED EVENT BUS: every lifecycle transition is published to the
//     packages/core-runtime EventBus (`swarm:*` events) so monitors, healer
//     loops and the dashboard observe state without polling.
//   - LOCK-FREE ATOMIC STATE TRANSITIONS: the orchestrator state machine is
//     single-threaded (no locks required); each transition is one atomic
//     assignment plus an append-only journal entry carrying an epoch counter
//     (the only ordering primitive).
//   - ISOLATED MEMORY BOUNDARIES: agents operate on private overlay forks
//     (TransactionalPatcher) — no shared mutable state between agents; the
//     only serialization point is the coordinator's epoch commit/rollback.
// =============================================================================
import { EventBus, type KlynEvent } from '../../packages/core-runtime/src/EventBus.js';
import {
  AgentSwarm,
  type EpochOptions,
  type EpochResult,
  type SwarmRole,
  type SwarmVote,
} from './AgentSwarm.js';
import type { PatchPlanner } from '../patch_planner.js';
import type { FileOperation } from '../patch_generator.js';

export type OrchestratorState = 'idle' | 'running' | 'committed' | 'rolled_back' | 'timed_out';

export interface SwarmTask {
  id: string;
  query: string;
  operations: FileOperation[];
  /** Per-epoch hard budget in ms (default 5000). */
  timeoutMs?: number;
  repoRoot?: string;
  requireTester?: boolean;
  /** Optional external diagnostics provider (LSP daemon-backed). */
  diagnose?: EpochOptions['diagnose'];
}

export interface StateTransition {
  taskId: string;
  from: OrchestratorState;
  to: OrchestratorState;
  epoch: number;
  at: number;
}

export interface TaskRecord {
  taskId: string;
  state: OrchestratorState;
  votes: SwarmVote[];
  errors: string[];
  committed: boolean;
  filesWritten: string[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_JOURNAL_ENTRIES = 4096;
const MAX_RECORDS = 256;

/**
 * Append-only state transition journal. Transitions are atomic in the JS
 * single-threaded event loop — no mutexes, no spinlocks. The epoch counter
 * is the only ordering primitive: it strictly increases per transition.
 */
export class AtomicStateMachine {
  private state: OrchestratorState = 'idle';
  private epoch = 0;
  private journal: StateTransition[] = [];

  constructor(private bus: EventBus) {}

  get current(): OrchestratorState {
    return this.state;
  }

  /** Atomically move to `to` and publish a `swarm:state` event. */
  transition(taskId: string, to: OrchestratorState): StateTransition {
    const from = this.state;
    this.state = to; // atomic assignment — the whole transition
    const transition: StateTransition = {
      taskId,
      from,
      to,
      epoch: ++this.epoch,
      at: Date.now(),
    };
    this.journal.push(transition);
    if (this.journal.length > MAX_JOURNAL_ENTRIES) {
      this.journal = this.journal.slice(-MAX_JOURNAL_ENTRIES);
    }
    this.bus.publish({ type: 'swarm:state', payload: transition, timestamp: transition.at });
    return transition;
  }

  journalView(): readonly StateTransition[] {
    return this.journal;
  }

  reset(): void {
    this.state = 'idle';
    this.journal = [];
  }
}

export class AgentOrchestrator {
  private machine: AtomicStateMachine;
  private records = new Map<string, TaskRecord>();
  private completedCount = 0;

  constructor(
    private swarm: AgentSwarm,
    private bus: EventBus = new EventBus(),
    machine?: AtomicStateMachine
  ) {
    this.machine = machine ?? new AtomicStateMachine(bus);
  }

  /**
   * Dispatch a specialized-agent epoch. Non-blocking: the epoch runs on its
   * own forks; the caller's promise resolves when the epoch converges (or
   * its budget expires). Every transition is journaled + published.
   */
  async dispatch(task: SwarmTask): Promise<TaskRecord> {
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const abortSignal = { aborted: false };
    const startedAt = Date.now();

    this.machine.transition(task.id, 'running');
    this.publish('swarm:epoch:start', { taskId: task.id, query: task.query, timeoutMs });

    const epochOptions: EpochOptions = {
      repoRoot: task.repoRoot,
      requireTester: task.requireTester,
      diagnose: task.diagnose,
      signal: abortSignal,
    };

    let outcome: EpochResult;
    let timedOut = false;
    try {
      outcome = await withTimeout(
        this.swarm.runEpochOps(task.operations, task.query, epochOptions),
        timeoutMs,
        task.id
      );
    } catch (error) {
      // Budget exhausted — flag the epoch so its commit checkpoint rolls back.
      abortSignal.aborted = true;
      timedOut = true;
      this.machine.transition(task.id, 'timed_out');
      this.publish('swarm:epoch:timeout', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.record(task, {
        state: 'timed_out',
        votes: [],
        errors: [error instanceof Error ? error.message : String(error)],
        committed: false,
        filesWritten: [],
        startedAt,
      });
    }

    for (const vote of outcome.votes) {
      this.publish('swarm:agent:vote', {
        taskId: task.id,
        agent: vote.agent,
        role: vote.role,
        approved: vote.approved,
        reason: vote.reason,
      });
    }

    const state: OrchestratorState = outcome.committed ? 'committed' : 'rolled_back';
    this.machine.transition(task.id, state);
    this.publish(outcome.committed ? 'swarm:epoch:committed' : 'swarm:epoch:rolled_back', {
      taskId: task.id,
      filesWritten: outcome.filesWritten,
      errors: outcome.errors,
    });

    return this.record(task, {
      state,
      votes: outcome.votes,
      errors: outcome.errors,
      committed: outcome.committed,
      filesWritten: outcome.filesWritten,
      startedAt,
    });
  }

  /** Strict per-epoch budget via a race with a reject timer. */
  private async record(
    task: SwarmTask,
    data: {
      state: OrchestratorState;
      votes: SwarmVote[];
      errors: string[];
      committed: boolean;
      filesWritten: string[];
      startedAt: number;
    }
  ): Promise<TaskRecord> {
    const finishedAt = Date.now();
    const record: TaskRecord = {
      taskId: task.id,
      state: data.state,
      votes: data.votes,
      errors: data.errors,
      committed: data.committed,
      filesWritten: data.filesWritten,
      startedAt: data.startedAt,
      finishedAt,
      durationMs: finishedAt - data.startedAt,
    };
    this.records.set(task.id, record);
    if (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
    this.completedCount++;
    return record;
  }

  private publish(type: string, payload: unknown): void {
    this.bus.publish({ type, payload, timestamp: Date.now() } satisfies KlynEvent);
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  get state(): OrchestratorState {
    return this.machine.current;
  }

  getStateMachine(): AtomicStateMachine {
    return this.machine;
  }

  getRecord(taskId: string): TaskRecord | undefined {
    const r = this.records.get(taskId);
    return r ? { ...r, votes: [...r.votes] } : undefined;
  }

  getStats(): {
    state: OrchestratorState;
    epoch: number;
    journalLength: number;
    completed: number;
    retainedRecords: number;
  } {
    return {
      state: this.machine.current,
      epoch: this.machine.journalView().length ? this.machine.journalView()[this.machine.journalView().length - 1].epoch : 0,
      journalLength: this.machine.journalView().length,
      completed: this.completedCount,
      retainedRecords: this.records.size,
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Agent epoch "${label}" exceeded ${ms}ms execution budget`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Convenience: fresh orchestrator over the singleton swarm machinery. */
export function createOrchestrator(planner: PatchPlanner, bus?: EventBus): AgentOrchestrator {
  const swarm = new AgentSwarm(planner);
  return new AgentOrchestrator(swarm, bus);
}

export default AgentOrchestrator;
