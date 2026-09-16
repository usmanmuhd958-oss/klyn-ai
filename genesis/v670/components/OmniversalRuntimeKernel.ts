/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 02: OmniversalRuntimeKernel
 * File: genesis/v670/components/OmniversalRuntimeKernel.ts
 * Version: 1.0.0
 *
 * The runtime-first substrate of the V670 architecture. It owns:
 *   - The omniversal event bus (in-process) bridged into the 0.kernel bus.
 *   - The kernel task queue (kernel/task-queue) as the scheduling substrate.
 *   - An SPSC dispatch ring buffer (mirrors 0.kernel/src/ringbuf.rs).
 *   - The Unix domain socket transport (sub-millisecond IPC).
 *   - The V670Module registry and lifecycle coordination.
 *   - Health snapshots and latency statistics.
 *
 * Wired into real layers: 0.kernel/kernel.ts (runtime kernel),
 * 0.kernel/bus.ts (KernelEventBus), kernel/task-queue.ts, kernel/logger.ts.
 * =============================================================================
 */

import os from 'node:os';
import path from 'node:path';
import { Kernel } from '../../../0.kernel/kernel.js';
import type { KernelEventBus } from '../../../0.kernel/bus.js';
import { createLogger } from '../../../kernel/logger.js';
import { TaskQueue, TASK_PRIORITY } from '../../../kernel/task-queue.js';
import { V670Bus } from '../ipc/ipc-bus.js';
import { RingBuffer } from '../ipc/ring-buffer.js';
import { UdsServer } from '../ipc/uds-server.js';
import {
  defaultV670Config,
  moduleMetrics,
  type BusEvent,
  type HealthSnapshot,
  type ModuleMetrics,
  type RuntimeContext,
  type V670Config,
  type V670Logger,
  type V670Module,
} from '../types.js';

export interface RuntimeKernelOptions {
  config?: Partial<V670Config>;
  bus?: V670Bus;
}

export interface DispatchItem {
  id: string;
  kind: string;
  payload: unknown;
  enqueuedAt: number;
}

let dispatchSeq = 0;

export class OmniversalRuntimeKernel {
  [key: string]: any;

  readonly config: V670Config;
  readonly logger: V670Logger;
  readonly bus: V670Bus;
  readonly kernel: Kernel;
  readonly taskQueue: TaskQueue;
  readonly dispatchRing: RingBuffer<DispatchItem>;

  private udsServer: UdsServer | null = null;
  private modules = new Map<string, V670Module>();
  private startedAt: number | null = null;
  private status: HealthSnapshot['status'] = 'stopped';
  private ctx: RuntimeContext;
  private queueStatus = { pending: 0 };

  constructor(options: RuntimeKernelOptions = {}) {
    this.config = defaultV670Config(options.config);

    const coreLogger = createLogger(`v670:${this.config.kernelId}`);
    this.logger = {
      info: (message, meta) => { try { (coreLogger as any).info?.(message, meta); } catch { /* noop */ } },
      warn: (message, meta) => { try { (coreLogger as any).warn?.(message, meta); } catch { /* noop */ } },
      error: (message, meta) => { try { (coreLogger as any).error?.(message, meta); } catch { /* noop */ } },
      debug: (message, meta) => { try { (coreLogger as any).debug?.(message, meta); } catch { /* noop */ } },
    };

    this.kernel = new Kernel();
    this.kernel.boot();

    this.bus = options.bus ?? new V670Bus({
      bridge: (type, payload, source, correlationId) => {
        try {
          (this.kernel.eventBus as KernelEventBus).publish(type as any, payload, source, correlationId);
        } catch { /* bridge must never break the bus */ }
      },
    });

    // Real TaskQueue substrate: persisted under tmp (or the configured dir).
    const tasksDir = this.config.persistDir
      ? path.join(this.config.persistDir, 'tasks')
      : path.join(os.tmpdir(), `klyn-v670-${process.pid}-tasks`);
    this.taskQueue = new TaskQueue(tasksDir);

    // Forward queued tasks onto the SPSC dispatch ring for the orchestrator.
    this.taskQueue.register('v670.task', (task: any) => {
      this.dispatchRing.push({
        id: task?.id ?? `dispatch_${++dispatchSeq}_${Date.now()}`,
        kind: task?.type ?? 'task',
        payload: task?.payload,
        enqueuedAt: Date.now(),
      });
    });

    this.dispatchRing = new RingBuffer<DispatchItem>({ capacity: 4096, overwrite: true });

    this.ctx = {
      config: this.config,
      logger: this.logger,
      publish: (type, payload, source, correlationId) =>
        this.publish(type, payload, source ?? 'v670', correlationId),
      request: (type, payload, timeoutMs) => this.bus.request(type, payload, timeoutMs),
      subscribe: (type, handler) => this.bus.subscribe(type, handler),
      memory: null,
      now: () => Date.now(),
    };
  }

  /** Inject the shared memory substrate into the runtime context. */
  public setSharedMemory(store: unknown): void {
    this.ctx.memory = store;
  }

  public getContext(): RuntimeContext {
    return this.ctx;
  }

  /** Register a V670 module. Calls module.register(ctx) immediately. */
  public register(module: V670Module): void {
    if (this.modules.has(module.id)) {
      throw new Error(`V670 module '${module.id}' already registered`);
    }
    module.register(this.ctx);
    this.modules.set(module.id, module);
    this.logger.info(`module registered: ${module.id} (${module.name})`);
  }

  /** Start the IPC transport, queue processor, and all modules. */
  public async start(): Promise<void> {
    if (this.startedAt !== null) return;
    this.startedAt = Date.now();

    if (this.config.enableIpc) {
      this.udsServer = new UdsServer({ socketPath: this.config.ipcSocketPath ?? undefined });
      try {
        const socketPath = await this.udsServer.start();
        this.logger.info(`UDS transport listening: ${socketPath}`);
      } catch (err) {
        this.logger.warn(`UDS transport unavailable: ${(err as Error).message}`);
        this.udsServer = null;
      }
    }

    // Start the persisted task queue (poll loop).
    try {
      this.taskQueue.start();
    } catch (err) {
      this.logger.warn(`task queue start: ${(err as Error).message}`);
    }

    this.status = 'booted';
    for (const module of this.modules.values()) {
      try {
        await module.start(this.ctx);
      } catch (err) {
        module.status = 'faulted';
        module.lastError = (err as Error).message;
        this.logger.error(`module '${module.id}' failed to start: ${(err as Error).message}`);
      }
    }
    this.logger.info(`runtime kernel online: ${this.modules.size} modules`);
  }

  /** Graceful shutdown in reverse registration order. */
  public async stop(): Promise<void> {
    try {
      this.taskQueue.stop();
    } catch { /* isolate */ }
    for (const module of Array.from(this.modules.values()).reverse()) {
      try {
        await module.stop();
      } catch (err) {
        this.logger.error(`module '${module.id}' stop error: ${(err as Error).message}`);
      }
    }
    if (this.udsServer) {
      await this.udsServer.stop();
      this.udsServer = null;
    }
    this.status = 'stopped';
    this.logger.info('runtime kernel stopped');
  }

  public async dispose(): Promise<void> {
    for (const module of Array.from(this.modules.values()).reverse()) {
      try {
        await module.dispose();
      } catch { /* isolate */ }
    }
    this.modules.clear();
    this.bus.dispose();
    this.kernel.shutdown();
  }

  /** Publish an event on the omniversal bus. */
  public publish(type: string, payload: unknown, source = 'v670', correlationId?: string): void {
    this.bus.publish(type, payload, source, correlationId);
  }

  /** In-process request/reply. */
  public request(type: string, payload: unknown, timeoutMs?: number): Promise<unknown> {
    return this.bus.request(type, payload, timeoutMs);
  }

  /** Subscribe to bus events. Returns unsubscribe. */
  public subscribe(type: string, handler: (event: BusEvent) => void): () => void {
    return this.bus.subscribe(type, handler);
  }

  /** Enqueue a task onto the real kernel TaskQueue (persisted substrate). */
  public enqueueTask(
    title: string,
    type: string,
    payload: unknown,
    options: { priority?: number; delayMs?: number } = {}
  ): string {
    const task = this.taskQueue.enqueue(title, type, payload, {
      priority: options.priority ?? TASK_PRIORITY.NORMAL,
      delayMs: options.delayMs,
    }) as any;
    return task?.id ?? '';
  }

  /** Push a dispatch item directly onto the SPSC ring. */
  public dispatch(kind: string, payload: unknown): boolean {
    return this.dispatchRing.push({
      id: `dispatch_${++dispatchSeq}_${Date.now()}`,
      kind,
      payload,
      enqueuedAt: Date.now(),
    });
  }

  public getModule(id: string): V670Module | undefined {
    return this.modules.get(id);
  }

  public getModules(): V670Module[] {
    return Array.from(this.modules.values());
  }

  public getUdsServer(): UdsServer | null {
    return this.udsServer;
  }

  public getHealth(): HealthSnapshot {
    const modules: ModuleMetrics[] = Array.from(this.modules.values()).map((m) => m.metrics());
    const busMetrics = this.bus.getMetrics();
    const queue = this.taskQueue.getStatus();
    this.queueStatus = { pending: (queue as any)?.pending ?? (queue as any)?.queueDepth ?? 0 };
    return {
      kernelId: this.config.kernelId,
      status: this.status,
      uptimeMs: this.startedAt === null ? 0 : Date.now() - this.startedAt,
      modules,
      eventCount: busMetrics.totalEvents,
      ipcLatency: this.udsServer ? this.udsServer.getLatency() : null,
      queueDepth: this.queueStatus.pending,
      ringDepth: this.dispatchRing.depth,
      memoryEntries: (this.ctx.memory as any)?.getStats?.().totalEntries ?? 0,
      timestamp: Date.now(),
    };
  }

  public moduleMetricsById(id: string): ModuleMetrics {
    const module = this.modules.get(id);
    if (!module) {
      return moduleMetrics(id, id, 'stopped', null);
    }
    return module.metrics();
  }

  public getStats() {
    const queue = this.taskQueue.getStatus();
    return {
      uptimeMs: this.startedAt === null ? 0 : Date.now() - this.startedAt,
      modules: this.modules.size,
      bus: this.bus.getMetrics(),
      ring: this.dispatchRing.getStats(),
      queue: queue,
      uds: this.udsServer?.getStats() ?? null,
      taskPriority: TASK_PRIORITY,
    };
  }
}

export default OmniversalRuntimeKernel;
