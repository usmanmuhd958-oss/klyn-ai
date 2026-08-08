/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Hive Orchestrator
 * File: 1.brain/orchestrator.ts
 * Version: 1.0.0
 *
 * The Hive is the multi-agent swarm orchestrator of the brain layer. It:
 *   - Registers typed agents by role.
 *   - Dispatches tasks to the least-loaded capable agent with timeout isolation.
 *   - Broadcasts fan-out tasks to all agents.
 *   - Supports deferred scheduling through the brain Scheduler.
 * =============================================================================
 */

import { Scheduler, type SchedulerPriority } from './scheduler.js';

export type AgentStatus = 'idle' | 'busy' | 'faulted';

export interface HiveTask {
  id: string;
  kind: string;
  payload: unknown;
  priority: SchedulerPriority;
  timeoutMs: number;
}

export interface HiveTaskResult {
  ok: boolean;
  agentId: string | null;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface HiveAgent {
  id: string;
  role: string;
  handler: (task: HiveTask) => Promise<unknown> | unknown;
  status: AgentStatus;
  tasksCompleted: number;
  faultCount: number;
  lastError?: string;
}

export interface HiveStats {
  agents: number;
  idle: number;
  busy: number;
  faulted: number;
  tasksCompleted: number;
  totalFaults: number;
  pendingScheduled: number;
}

let hiveSeq = 0;

export class Hive {
  [key: string]: any;
  private agents = new Map<string, HiveAgent>();
  private scheduler: Scheduler;

  constructor(scheduler?: Scheduler) {
    this.scheduler = scheduler ?? new Scheduler();
  }

  /** Register an agent by unique id and role. */
  public registerAgent(
    id: string,
    role: string,
    handler: (task: HiveTask) => Promise<unknown> | unknown
  ): void {
    if (this.agents.has(id)) {
      throw new Error(`Hive: agent '${id}' already registered`);
    }
    this.agents.set(id, { id, role, handler, status: 'idle', tasksCompleted: 0, faultCount: 0 });
  }

  public unregisterAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  public getAgent(id: string): HiveAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * Dispatch a task to the first idle agent that can handle its kind
   * (agent role matches task kind, or no kind filter). Runs with timeout.
   */
  public async dispatch(
    kind: string,
    payload: unknown,
    options: { timeoutMs?: number; priority?: SchedulerPriority } = {}
  ): Promise<HiveTaskResult> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const priority = options.priority ?? 'normal';

    const candidate = this.nextIdleAgent(kind);
    if (!candidate) {
      return { ok: false, agentId: null, error: 'no idle agent available', durationMs: 0 };
    }

    const task: HiveTask = {
      id: `hive_${++hiveSeq}_${Date.now()}`,
      kind,
      payload,
      priority,
      timeoutMs,
    };

    candidate.status = 'busy';
    const started = Date.now();
    try {
      const output = await withTimeout(() => candidate.handler(task), timeoutMs);
      candidate.tasksCompleted++;
      return { ok: true, agentId: candidate.id, output, durationMs: Date.now() - started };
    } catch (err) {
      candidate.faultCount++;
      return {
        ok: false,
        agentId: candidate.id,
        error: (err as Error).message,
        durationMs: Date.now() - started,
      };
    } finally {
      candidate.status = 'idle';
    }
  }

  /** Broadcast a task to all agents that can handle its kind. */
  public async broadcast(
    kind: string,
    payload: unknown,
    options: { timeoutMs?: number } = {}
  ): Promise<HiveTaskResult[]> {
    const handlers = Array.from(this.agents.values()).filter(
      (agent) => agent.status !== 'faulted' && (kind === '*' || agent.role === kind)
    );
    const timeoutMs = options.timeoutMs ?? 30_000;

    const results = await Promise.all(
      handlers.map(async (agent) => {
        const task: HiveTask = {
          id: `hive_b_${++hiveSeq}_${Date.now()}`,
          kind,
          payload,
          priority: 'normal',
          timeoutMs,
        };
        agent.status = 'busy';
        const started = Date.now();
        try {
          const output = await withTimeout(() => agent.handler(task), timeoutMs);
          agent.tasksCompleted++;
          return { ok: true, agentId: agent.id, output, durationMs: Date.now() - started };
        } catch (err) {
          agent.faultCount++;
          return {
            ok: false,
            agentId: agent.id,
            error: (err as Error).message,
            durationMs: Date.now() - started,
          };
        } finally {
          agent.status = 'idle';
        }
      })
    );

    return results;
  }

  /** Defer a dispatch through the scheduler. */
  public scheduleDeferred(
    kind: string,
    payload: unknown,
    delayMs: number,
    priority: SchedulerPriority = 'normal'
  ): string {
    return this.scheduler.schedule(
      `hive:${kind}`,
      () => {
        void this.dispatch(kind, payload, { priority });
      },
      delayMs,
      priority
    );
  }

  public fault(agentId: string, reason: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.faultCount++;
    agent.status = 'faulted';
    agent.lastError = reason;
  }

  public revive(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.status = 'idle';
  }

  public getStats(): HiveStats {
    const all = Array.from(this.agents.values());
    return {
      agents: all.length,
      idle: all.filter((a) => a.status === 'idle').length,
      busy: all.filter((a) => a.status === 'busy').length,
      faulted: all.filter((a) => a.status === 'faulted').length,
      tasksCompleted: all.reduce((acc, a) => acc + a.tasksCompleted, 0),
      totalFaults: all.reduce((acc, a) => acc + a.faultCount, 0),
      pendingScheduled: this.scheduler.pendingCount(),
    };
  }

  public dispose(): void {
    this.scheduler.dispose();
    this.agents.clear();
  }

  private nextIdleAgent(kind: string): HiveAgent | undefined {
    const candidates = Array.from(this.agents.values()).filter(
      (agent) =>
        agent.status === 'idle' &&
        (kind === '*' || agent.role === kind || kind === '') &&
        agent.faultCount < 5
    );
    // Least-loaded first.
    candidates.sort((a, b) => a.tasksCompleted - b.tasksCompleted);
    return candidates[0];
  }
}

// ---------------------------------------------------------------------------
// PRIVATE HELPERS
// ---------------------------------------------------------------------------

function withTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Hive task timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve()
      .then(fn)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export default Hive;
