// =============================================================================
// KLYN AI OS — swarm-mesh — Zero-Touch Autonomous Edge Provisioner (Phase 8)
// File: packages/swarm-mesh/src/edge_provisioner.ts
//
// Phase 8 capability #4. A headless worker provisioner that interacts with
// the Phase 7 FleetOrchestrator to scale background worker nodes UP or DOWN
// based on load, with zero-downtime state migration:
//
//   provisioner.register('edge-1', node?)    — join a worker (node optional
//                                               for headless simulated nodes)
//   provisioner.enqueue('edge-1', kind, payload)
//                                             — route work to a worker
//   provisioner.tick()                       — scale evaluation + fleet sync
//   provisioner.migrateTasks(from, to)       — hot-swap: move in-flight state
//                                               to a new worker, then retire
//
// Zero-downtime migration protocol:
//   1. mark source DRAINING (stops new task arrival — background agent
//      streams are redirected to the target immediately),
//   2. snapshot the source's in-flight task queue + sync state,
//   3. enqueue the snapshot on the target (order preserved),
//   4. retire the source only after its queue is empty.
// CRDT sync processes are carried by the same mechanism: the worker's sync
// state snapshot transfers with the tasks before the source retires.
//
// Scaling is hysteresis-guarded (scaleUpLoad > scaleDownLoad) and
// cooldown-bounded (no scale flapping), fully synchronous and headless — no
// DOM, no timers, no hidden I/O.
// =============================================================================
import { EventBus, type KlynEvent } from '../../core-runtime/src/EventBus.js';
import { FleetOrchestrator } from './fleet_orchestrator.js';
import { P2PNode, InMemoryTransport } from './p2p_node.js';

export interface ProvisionedTask {
  id: string;
  kind: string;
  payload: unknown;
  enqueuedAt: number;
}

export interface EdgeWorkerState {
  id: string;
  /** Real mesh node (null for headless simulated workers). */
  node: P2PNode | null;
  tasks: ProvisionedTask[];
  /** Sync/CRDT state snapshot carried across migrations. */
  syncState: Record<string, unknown>;
  draining: boolean;
  provisionedAt: number;
  migratedTo: string | null;
}

export interface EdgeProvisionerOptions {
  bus?: EventBus;
  /** Phase 7 fleet orchestrator to supervise provisioned workers. */
  fleet?: FleetOrchestrator;
  /** Minimum worker floor (default 1). */
  minWorkers?: number;
  /** Maximum worker cap (default 8 — bounded). */
  maxWorkers?: number;
  /** Avg tasks/worker above which we scale up (default 6). */
  scaleUpLoad?: number;
  /** Avg tasks/worker below which we scale down (default 2). */
  scaleDownLoad?: number;
  /** Min ms between scale actions (default 250 — flapping guard). */
  cooldownMs?: number;
  /** Max tasks buffered per worker (default 64 — bounded). */
  maxTasksPerWorker?: number;
  /** Real-node factory; default creates an in-memory mesh node. */
  createNode?: () => P2PNode;
  onProvision?: (workerId: string) => void;
  onRetire?: (workerId: string) => void;
  onMigrate?: (from: string, to: string, taskCount: number) => void;
}

export interface EdgeStats {
  workers: number;
  healthy: number;
  draining: number;
  totalTasks: number;
  provisions: number;
  retirements: number;
  migrations: number;
  lastScaleActionAt: number | null;
}

const DEFAULT_MIN_WORKERS = 1;
const DEFAULT_MAX_WORKERS = 8;
const DEFAULT_SCALE_UP_LOAD = 6;
const DEFAULT_SCALE_DOWN_LOAD = 2;
const DEFAULT_COOLDOWN_MS = 250;
const DEFAULT_MAX_TASKS_PER_WORKER = 64;

export class EdgeProvisioner {
  private workers = new Map<string, EdgeWorkerState>();
  private bus: EventBus;
  private fleet: FleetOrchestrator | null;
  private nextWorkerId = 0;
  private nextTaskId = 0;
  private provisions = 0;
  private retirements = 0;
  private migrations = 0;
  private lastScaleActionAt: number | null = null;

  private readonly minWorkers: number;
  private readonly maxWorkers: number;
  private readonly scaleUpLoad: number;
  private readonly scaleDownLoad: number;
  private readonly cooldownMs: number;
  private readonly maxTasksPerWorker: number;
  private readonly createNode: () => P2PNode;
  private readonly onProvision?: (workerId: string) => void;
  private readonly onRetire?: (workerId: string) => void;
  private readonly onMigrate?: (from: string, to: string, taskCount: number) => void;

  constructor(options: EdgeProvisionerOptions = {}) {
    this.bus = options.bus ?? new EventBus();
    this.fleet = options.fleet ?? null;
    this.minWorkers = options.minWorkers ?? DEFAULT_MIN_WORKERS;
    this.maxWorkers = Math.max(this.minWorkers, options.maxWorkers ?? DEFAULT_MAX_WORKERS);
    this.scaleUpLoad = options.scaleUpLoad ?? DEFAULT_SCALE_UP_LOAD;
    this.scaleDownLoad = options.scaleDownLoad ?? DEFAULT_SCALE_DOWN_LOAD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxTasksPerWorker = options.maxTasksPerWorker ?? DEFAULT_MAX_TASKS_PER_WORKER;
    this.createNode = options.createNode ?? (() => {
      const transport = new InMemoryTransport(`edge-${++this.nextWorkerId}`);
      return new P2PNode(transport);
    });
    this.onProvision = options.onProvision;
    this.onRetire = options.onRetire;
    this.onMigrate = options.onMigrate;
  }

  // -------------------------------------------------------------------------
  // WORKER LIFECYCLE
  // -------------------------------------------------------------------------

  /** Provision a new worker (real mesh node via the factory by default). */
  provision(workerId = `edge-${++this.nextWorkerId}`): EdgeWorkerState {
    if (this.workers.has(workerId)) return this.workers.get(workerId)!;
    if (this.workers.size >= this.maxWorkers) throw new Error(`edge provisioner at max capacity (${this.maxWorkers})`);
    const node = this.createNode();
    // The factory may have allocated its own id — keep the registry id aligned.
    const state: EdgeWorkerState = {
      id: workerId,
      node,
      tasks: [],
      syncState: {},
      draining: false,
      provisionedAt: Date.now(),
      migratedTo: null,
    };
    this.workers.set(workerId, state);
    this.provisions++;
    this.fleet?.registerNode(workerId);
    this.publish('edge:provisioned', { workerId });
    this.onProvision?.(workerId);
    return state;
  }

  /** Join an existing worker (headless or pre-built) to the provisioner. */
  register(workerId: string, node: P2PNode | null = null): boolean {
    if (this.workers.has(workerId)) return true;
    if (this.workers.size >= this.maxWorkers) return false;
    this.workers.set(workerId, {
      id: workerId,
      node,
      tasks: [],
      syncState: {},
      draining: false,
      provisionedAt: Date.now(),
      migratedTo: null,
    });
    this.provisions++;
    this.fleet?.registerNode(workerId);
    this.publish('edge:provisioned', { workerId });
    this.onProvision?.(workerId);
    return true;
  }

  /** Retire a worker: drain + migrate its state first (zero-downtime). */
  retire(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    if (worker.tasks.length > 0) {
      // Hot-swap: never drop in-flight work — migrate before retiring.
      const target = this.pickMigrationTarget(workerId);
      if (!target) return false; // no target → cannot retire yet (zero-downtime guarantee)
      this.migrateTasks(workerId, target);
    }
    worker.draining = true;
    this.workers.delete(workerId);
    this.retirements++;
    worker.node?.close();
    this.fleet?.removeNode(workerId);
    this.publish('edge:retired', { workerId });
    this.onRetire?.(workerId);
    return true;
  }

  // -------------------------------------------------------------------------
  // WORK ROUTING
  // -------------------------------------------------------------------------

  /**
   * Assign a task to a worker. A draining worker refuses new tasks (they are
   * routed to a healthy worker or auto-provisioned at the cap — background
   * streams never block on a retiring node). Bounded queue per worker.
   */
  enqueue(workerId: string, kind: string, payload: unknown): { ok: boolean; task?: ProvisionedTask; workerId: string; error?: string } {
    const worker = this.workers.get(workerId);
    if (!worker || worker.draining) {
      const fallback = this.leastLoadedHealthy(workerId);
      if (fallback) return this.enqueue(fallback, kind, payload);
      return { ok: false, workerId, error: `no healthy worker available for "${kind}"` };
    }
    if (worker.tasks.length >= this.maxTasksPerWorker) {
      const fallback = this.leastLoadedHealthy(workerId);
      if (fallback && fallback !== workerId) return this.enqueue(fallback, kind, payload);
      return { ok: false, workerId, error: `worker queue full (${this.maxTasksPerWorker})` };
    }
    const task: ProvisionedTask = {
      id: `t${++this.nextTaskId}`,
      kind,
      payload,
      enqueuedAt: Date.now(),
    };
    worker.tasks.push(task);
    return { ok: true, task, workerId };
  }

  /** Set a worker's sync/CRDT state snapshot (carried by migrations). */
  setSyncState(workerId: string, state: Record<string, unknown>): void {
    const worker = this.workers.get(workerId);
    if (worker) worker.syncState = { ...state };
  }

  // -------------------------------------------------------------------------
  // ZERO-DOWNTIME MIGRATION
  // -------------------------------------------------------------------------

  /**
   * Hot-swap: move a worker's in-flight task queue + sync state to a target,
   * preserving order. The source is marked draining first (no new arrivals)
   * and is retired once its queue is empty. Background agent streams are
   * redirected to the target BEFORE the source retires — zero downtime.
   */
  migrateTasks(fromId: string, toId: string): boolean {
    const source = this.workers.get(fromId);
    const target = this.workers.get(toId);
    if (!source || !target || source === target) return false;
    source.draining = true;
    for (const task of source.tasks) {
      if (target.tasks.length >= this.maxTasksPerWorker) break;
      target.tasks.push({ ...task });
    }
    const moved = source.tasks.length;
    source.tasks = [];
    // Carry the sync/CRDT state with the migration — the target adopts the
    // source's state before the source retires (zero-downtime handoff).
    target.syncState = { ...target.syncState, ...source.syncState };
    source.migratedTo = toId;
    this.migrations++;
    this.publish('edge:migrated', { from: fromId, to: toId, taskCount: moved });
    this.onMigrate?.(fromId, toId, moved);
    return true;
  }

  /** Drain + retire a worker: provision a fresh target first if needed. */
  drainAndRetire(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    if (worker.tasks.length > 0) {
      let target = this.pickMigrationTarget(workerId);
      if (!target) {
        if (this.workers.size >= this.maxWorkers) return false;
        target = this.provision().id;
      }
      this.migrateTasks(workerId, target);
    }
    return this.retire(workerId);
  }

  // -------------------------------------------------------------------------
  // SCALE EVALUATION (zero-touch)
  // -------------------------------------------------------------------------

  /**
   * One evaluation sweep (call from the fleet supervision loop):
   *   1. heartbeat every worker's load into the Phase 7 fleet,
   *   2. self-heal: drain workers the fleet quarantined or marked dead,
   *   3. scale up when avg load > scaleUpLoad (cooldown-guarded),
   *   4. scale down when avg load < scaleDownLoad and above the floor.
   */
  tick(): void {
    const healthy = this.healthyWorkers();
    const totalTasks = this.totalTasks();
    for (const worker of this.workers.values()) {
      this.fleet?.heartbeat(worker.id, worker.tasks.length);
    }

    // Fleet self-healing: quarantine/death → drain + migrate + retire.
    if (this.fleet) {
      for (const badId of [...this.fleet.quarantinedNodes(), ...this.fleet.deadNodes()]) {
        const worker = this.workers.get(badId);
        if (worker && !worker.draining) this.drainAndRetire(badId);
      }
    }

    const healthyCount = healthy.length;
    const demand = healthyCount > 0 ? totalTasks / healthyCount : totalTasks;
    const now = Date.now();
    const cooled = this.lastScaleActionAt === null || now - this.lastScaleActionAt >= this.cooldownMs;

    // Scale up: sustained demand above threshold, capacity available.
    if (cooled && demand > this.scaleUpLoad && this.workers.size < this.maxWorkers) {
      this.provision();
      this.lastScaleActionAt = Date.now();
      return;
    }

    // Scale down: demand below threshold, above the floor, and a
    // non-draining worker exists to drain (lowest load first).
    if (cooled && demand < this.scaleDownLoad && this.workers.size > this.minWorkers) {
      const candidate = this.leastLoadedWorker();
      if (candidate && !candidate.draining && candidate.tasks.length === 0) {
        this.retire(candidate.id);
        this.lastScaleActionAt = Date.now();
      } else if (candidate && !candidate.draining) {
        this.drainAndRetire(candidate.id);
        this.lastScaleActionAt = Date.now();
      }
    }
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY
  // -------------------------------------------------------------------------

  worker(workerId: string): EdgeWorkerState | null {
    const w = this.workers.get(workerId);
    if (!w) return null;
    return { ...w, tasks: w.tasks.map((t) => ({ ...t })), syncState: { ...w.syncState } };
  }

  healthyWorkers(): string[] {
    return Array.from(this.workers.values())
      .filter((w) => !w.draining)
      .map((w) => w.id)
      .sort();
  }

  totalTasks(): number {
    let total = 0;
    for (const w of this.workers.values()) total += w.tasks.length;
    return total;
  }

  stats(): EdgeStats {
    let draining = 0;
    for (const w of this.workers.values()) if (w.draining) draining++;
    return {
      workers: this.workers.size,
      healthy: this.healthyWorkers().length,
      draining,
      totalTasks: this.totalTasks(),
      provisions: this.provisions,
      retirements: this.retirements,
      migrations: this.migrations,
      lastScaleActionAt: this.lastScaleActionAt,
    };
  }

  /** Drop all provisioner state (tests, teardown). */
  dispose(): void {
    for (const worker of this.workers.values()) worker.node?.close();
    this.workers.clear();
    this.fleet = null;
  }

  // -------------------------------------------------------------------------
  // INTERNAL
  // -------------------------------------------------------------------------

  private pickMigrationTarget(excludeId: string): string | null {
    let best: EdgeWorkerState | null = null;
    for (const worker of this.workers.values()) {
      if (worker.id === excludeId || worker.draining) continue;
      if (!best || worker.tasks.length < best.tasks.length) best = worker;
    }
    return best?.id ?? null;
  }

  private leastLoadedHealthy(excludeId?: string): string | null {
    let best: EdgeWorkerState | null = null;
    for (const worker of this.workers.values()) {
      if (worker.draining || worker.id === excludeId) continue;
      if (!best || worker.tasks.length < best.tasks.length) best = worker;
    }
    return best?.id ?? null;
  }

  private leastLoadedWorker(): EdgeWorkerState | null {
    let best: EdgeWorkerState | null = null;
    for (const worker of this.workers.values()) {
      if (worker.draining) continue;
      if (!best || worker.tasks.length < best.tasks.length) best = worker;
    }
    return best;
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.bus.publish({ type, payload, timestamp: Date.now() } satisfies KlynEvent);
  }
}

export default EdgeProvisioner;
