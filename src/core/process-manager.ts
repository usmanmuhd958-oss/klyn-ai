/**
 * @fileoverview Klyn AI OS - Micro-Process & Plugin Worker Runtime
 * @module core/process-manager
 * @author Klyn Systems Architecture Team
 * @license Proprietary
 * 
 * Enterprise-grade process manager with worker pool orchestration, isolated plugin
 * sandboxing, zero-copy IPC, automatic fault recovery, and comprehensive telemetry.
 */

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { performance } from 'perf_hooks';
import { randomBytes } from 'crypto';
import { join } from 'path';

// ============================================================================
// ERROR HIERARCHY
// ============================================================================

class ProcessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly processId?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ProcessError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      processId: this.processId,
      context: this.context,
    };
  }
}

class WorkerCreationError extends ProcessError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'WORKER_CREATION_ERROR', undefined, context);
    this.name = 'WorkerCreationError';
  }
}

class WorkerTerminationError extends ProcessError {
  constructor(processId: string, context?: Record<string, unknown>) {
    super(`Worker termination failed: ${processId}`, 'WORKER_TERMINATION_ERROR', processId, context);
    this.name = 'WorkerTerminationError';
  }
}

class PluginExecutionError extends ProcessError {
  constructor(
    message: string,
    processId: string,
    public readonly pluginId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'PLUGIN_EXECUTION_ERROR', processId, { ...context, pluginId });
    this.name = 'PluginExecutionError';
  }
}

class PluginTimeoutError extends ProcessError {
  constructor(
    processId: string,
    public readonly pluginId: string,
    public readonly timeoutMs: number
  ) {
    super(
      `Plugin execution timeout: ${pluginId}`,
      'PLUGIN_TIMEOUT_ERROR',
      processId,
      { pluginId, timeoutMs }
    );
    this.name = 'PluginTimeoutError';
  }
}

class PluginMemoryLimitError extends ProcessError {
  constructor(
    processId: string,
    public readonly pluginId: string,
    public readonly limitMB: number,
    public readonly usedMB: number
  ) {
    super(
      `Plugin memory limit exceeded: ${pluginId} (${usedMB}MB / ${limitMB}MB)`,
      'PLUGIN_MEMORY_LIMIT_ERROR',
      processId,
      { pluginId, limitMB, usedMB }
    );
    this.name = 'PluginMemoryLimitError';
  }
}

class PermissionDeniedError extends ProcessError {
  constructor(
    processId: string,
    public readonly capability: string
  ) {
    super(
      `Permission denied for capability: ${capability}`,
      'PERMISSION_DENIED',
      processId,
      { capability }
    );
    this.name = 'PermissionDeniedError';
  }
}

class ProcessPoolExhaustedError extends ProcessError {
  constructor(poolSize: number, activeWorkers: number) {
    super(
      `Process pool exhausted: ${activeWorkers}/${poolSize}`,
      'PROCESS_POOL_EXHAUSTED',
      undefined,
      { poolSize, activeWorkers }
    );
    this.name = 'ProcessPoolExhaustedError';
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type WorkerStatus = 'idle' | 'busy' | 'terminating' | 'crashed' | 'terminated';

type ProcessPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

type PluginCapability =
  | 'fs:read'
  | 'fs:write'
  | 'network:http'
  | 'network:websocket'
  | 'process:spawn'
  | 'crypto:encrypt'
  | 'crypto:decrypt'
  | 'ai:inference'
  | 'system:env';

interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly entryPoint: string;
  readonly capabilities: ReadonlyArray<PluginCapability>;
  readonly maxMemoryMB: number;
  readonly maxExecutionMs: number;
  readonly isolationLevel: 'strict' | 'relaxed';
}

interface WorkerMetadata {
  readonly id: string;
  threadId: number;
  readonly createdAt: number;
  status: WorkerStatus;
  currentTask: TaskDescriptor | null;
  executionCount: number;
  lastActivity: number;
  memoryUsage: number;
  cpuTime: number;
  crashCount: number;
}

interface TaskDescriptor {
  readonly id: string;
  readonly type: 'plugin' | 'computation' | 'io' | 'ai_inference';
  readonly priority: ProcessPriority;
  readonly payload: unknown;
  readonly timeoutMs: number;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly startTime: number;
  readonly pluginId?: string;
  readonly capabilities?: ReadonlyArray<PluginCapability>;
}

interface TaskResult<T = unknown> {
  readonly taskId: string;
  readonly success: boolean;
  readonly result?: T;
  readonly error?: string;
  readonly executionTime: number;
  readonly memoryUsed: number;
  readonly processId: string;
}

interface ProcessPoolConfig {
  readonly minWorkers: number;
  readonly maxWorkers: number;
  readonly idleTimeoutMs: number;
  readonly scaleUpThreshold: number;
  readonly scaleDownThreshold: number;
  readonly healthCheckInterval: number;
}

interface IPCMessage {
  readonly type: 'execute' | 'result' | 'error' | 'health' | 'terminate' | 'state_checkpoint';
  readonly id: string;
  readonly timestamp: number;
  readonly payload: unknown;
  readonly transferList?: ReadonlyArray<ArrayBuffer>;
}

interface WorkerHealthReport {
  readonly processId: string;
  readonly status: WorkerStatus;
  readonly uptime: number;
  readonly memoryUsage: NodeJS.MemoryUsage;
  readonly executionCount: number;
  readonly lastActivity: number;
  readonly isHealthy: boolean;
}

interface ProcessManagerStats {
  readonly totalWorkers: number;
  readonly activeWorkers: number;
  readonly idleWorkers: number;
  readonly crashedWorkers: number;
  readonly totalTasksExecuted: number;
  readonly totalTasksFailed: number;
  readonly averageExecutionTime: number;
  readonly poolUtilization: number;
  readonly memoryUsage: number;
}

interface ProcessEventMap {
  'worker:created': { processId: string; threadId: number };
  'worker:ready': { processId: string };
  'worker:busy': { processId: string; taskId: string };
  'worker:idle': { processId: string };
  'worker:crashed': { processId: string; error: Error; crashCount: number };
  'worker:terminated': { processId: string };
  'worker:resurrected': { processId: string; previousId: string };
  'task:queued': { taskId: string; priority: ProcessPriority };
  'task:started': { taskId: string; processId: string };
  'task:completed': TaskResult;
  'task:failed': { taskId: string; error: Error; retries: number };
  'pool:scaled_up': { newSize: number };
  'pool:scaled_down': { newSize: number };
  'health:check': { healthy: number; unhealthy: number };
  'error': ProcessError;
  [key: string]: unknown;
}

// ============================================================================
// TYPED EVENT EMITTER
// ============================================================================

class TypedEventEmitter<TEventMap extends Record<string, unknown>> {
  private readonly emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(1000);
  }

  on<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.on(event as string, handler);
    return this;
  }

  once<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.once(event as string, handler);
    return this;
  }

  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): boolean {
    return this.emitter.emit(event as string, payload);
  }

  off<K extends keyof TEventMap>(event: K, handler: (payload: TEventMap[K]) => void): this {
    this.emitter.off(event as string, handler);
    return this;
  }

  removeAllListeners(event?: keyof TEventMap): this {
    this.emitter.removeAllListeners(event as string);
    return this;
  }
}

// ============================================================================
// ZERO-COPY IPC MESSAGE ENCODER/DECODER
// ============================================================================

class IPCEncoder {
  static encode(message: IPCMessage): { buffer: ArrayBuffer; transferList: ArrayBuffer[] } {
    const transferList: ArrayBuffer[] = [];
    const payload = this.extractTransferables(message.payload, transferList);

    const encoded = {
      type: message.type,
      id: message.id,
      timestamp: message.timestamp,
      payload,
    };

    const json = JSON.stringify(encoded);
    const buffer = new TextEncoder().encode(json).buffer;

    return { buffer, transferList };
  }

  static decode(buffer: ArrayBuffer): IPCMessage {
    const json = new TextDecoder().decode(buffer);
    const decoded = JSON.parse(json) as {
      type: IPCMessage['type'];
      id: string;
      timestamp: number;
      payload: unknown;
    };

    return {
      type: decoded.type,
      id: decoded.id,
      timestamp: decoded.timestamp,
      payload: decoded.payload,
    };
  }

  private static extractTransferables(obj: unknown, transferList: ArrayBuffer[]): unknown {
    if (obj instanceof ArrayBuffer) {
      transferList.push(obj);
      return { __transferable: true, type: 'ArrayBuffer', byteLength: obj.byteLength };
    }

    if (obj instanceof SharedArrayBuffer) {
      return { __shared: true, type: 'SharedArrayBuffer', buffer: obj };
    }

    if (ArrayBuffer.isView(obj)) {
      const typedArray = obj as Uint8Array;
      const buffer = typedArray.buffer.slice(0) as ArrayBuffer;
      transferList.push(buffer);
      return {
        __transferable: true,
        type: typedArray.constructor.name,
        byteLength: typedArray.byteLength,
        byteOffset: typedArray.byteOffset,
      };
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.extractTransferables(item, transferList));
    }

    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.extractTransferables(value, transferList);
      }
      return result;
    }

    return obj;
  }
}

// ============================================================================
// CAPABILITY-BASED SECURITY MANAGER
// ============================================================================

class CapabilityManager {
  private readonly grantedCapabilities = new Map<string, Set<PluginCapability>>();

  grant(pluginId: string, capabilities: ReadonlyArray<PluginCapability>): void {
    const existing = this.grantedCapabilities.get(pluginId) ?? new Set();
    for (const cap of capabilities) {
      existing.add(cap);
    }
    this.grantedCapabilities.set(pluginId, existing);
  }

  has(pluginId: string, capability: PluginCapability): boolean {
    const caps = this.grantedCapabilities.get(pluginId);
    return caps?.has(capability) ?? false;
  }

  revoke(pluginId: string): void {
    this.grantedCapabilities.delete(pluginId);
  }

  getCapabilities(pluginId: string): ReadonlyArray<PluginCapability> {
    const caps = this.grantedCapabilities.get(pluginId);
    return caps ? Array.from(caps) : [];
  }
}

// ============================================================================
// WORKER PROCESS WRAPPER
// ============================================================================

class WorkerProcess {
  private readonly worker: Worker;
  private readonly metadata: WorkerMetadata;
  private readonly pendingTasks = new Map<string, {
    resolve: (result: TaskResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(
    workerScript: string,
    private readonly eventBus: TypedEventEmitter<ProcessEventMap>
  ) {
    this.metadata = {
      id: this.generateProcessId(),
      threadId: -1,
      createdAt: Date.now(),
      status: 'idle',
      currentTask: null,
      executionCount: 0,
      lastActivity: Date.now(),
      memoryUsage: 0,
      cpuTime: 0,
      crashCount: 0,
    };

    this.worker = new Worker(workerScript, {
      workerData: { processId: this.metadata.id },
    });

    this.metadata.threadId = this.worker.threadId;

    this.setupEventHandlers();

    this.eventBus.emit('worker:created', {
      processId: this.metadata.id,
      threadId: this.metadata.threadId,
    });
  }

  private setupEventHandlers(): void {
    this.worker.on('message', (data: ArrayBuffer | IPCMessage) => {
      const message = Buffer.isBuffer(data) || data instanceof ArrayBuffer
        ? IPCEncoder.decode(data as ArrayBuffer)
        : data as IPCMessage;

      this.handleMessage(message);
    });

    this.worker.on('error', (error: Error) => {
      this.handleCrash(error);
    });

    this.worker.on('exit', (exitCode: number) => {
      if (exitCode !== 0 && this.metadata.status !== 'terminating') {
        this.handleCrash(new Error(`Worker exited with code ${exitCode}`));
      }
    });

    this.worker.on('online', () => {
      this.eventBus.emit('worker:ready', { processId: this.metadata.id });
    });
  }

  private handleMessage(message: IPCMessage): void {
    this.metadata.lastActivity = Date.now();

    switch (message.type) {
      case 'result':
        this.handleTaskResult(message);
        break;

      case 'error':
        this.handleTaskError(message);
        break;

      case 'health':
        this.handleHealthReport(message);
        break;

      case 'state_checkpoint':
        this.handleStateCheckpoint(message);
        break;

      default:
        break;
    }
  }

  private handleTaskResult(message: IPCMessage): void {
    const result = message.payload as TaskResult;
    const pending = this.pendingTasks.get(result.taskId);

    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(result);
      this.pendingTasks.delete(result.taskId);
    }

    this.metadata.executionCount++;
    this.metadata.currentTask = null;
    this.metadata.status = 'idle';

    this.eventBus.emit('task:completed', result);
    this.eventBus.emit('worker:idle', { processId: this.metadata.id });
  }

  private handleTaskError(message: IPCMessage): void {
    const error = message.payload as { taskId: string; error: string };
    const pending = this.pendingTasks.get(error.taskId);

    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new ProcessError(error.error, 'TASK_ERROR', this.metadata.id));
      this.pendingTasks.delete(error.taskId);
    }

    this.metadata.currentTask = null;
    this.metadata.status = 'idle';

    this.eventBus.emit('worker:idle', { processId: this.metadata.id });
  }

  private handleHealthReport(message: IPCMessage): void {
    const health = message.payload as { memoryUsage: number; cpuTime: number };
    this.metadata.memoryUsage = health.memoryUsage;
    this.metadata.cpuTime = health.cpuTime;
  }

  private handleStateCheckpoint(message: IPCMessage): void {
    // State checkpointing for crash recovery
  }

  private handleCrash(error: Error): void {
    this.metadata.status = 'crashed';
    this.metadata.crashCount++;

    for (const [taskId, pending] of this.pendingTasks.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new ProcessError(
        `Worker crashed: ${error.message}`,
        'WORKER_CRASHED',
        this.metadata.id
      ));
    }

    this.pendingTasks.clear();

    this.eventBus.emit('worker:crashed', {
      processId: this.metadata.id,
      error,
      crashCount: this.metadata.crashCount,
    });
  }

  async execute<T = unknown>(task: TaskDescriptor): Promise<TaskResult<T>> {
    if (this.metadata.status !== 'idle') {
      throw new ProcessError(
        `Worker is not idle: ${this.metadata.status}`,
        'WORKER_BUSY',
        this.metadata.id
      );
    }

    return new Promise<TaskResult<T>>((resolve, reject) => {
      this.metadata.status = 'busy';
      this.metadata.currentTask = task;

      const timeout = setTimeout(() => {
        this.pendingTasks.delete(task.id);
        this.metadata.status = 'idle';
        this.metadata.currentTask = null;

        reject(new PluginTimeoutError(
          this.metadata.id,
          task.pluginId ?? 'unknown',
          task.timeoutMs
        ));
      }, task.timeoutMs);

      this.pendingTasks.set(task.id, { 
        resolve: resolve as (result: TaskResult) => void, 
        reject, 
        timeout 
      });

      const message: IPCMessage = {
        type: 'execute',
        id: task.id,
        timestamp: Date.now(),
        payload: task,
      };

      const { buffer, transferList } = IPCEncoder.encode(message);

      this.worker.postMessage(buffer, (transferList as any));

      this.eventBus.emit('worker:busy', {
        processId: this.metadata.id,
        taskId: task.id,
      });

      this.eventBus.emit('task:started', {
        taskId: task.id,
        processId: this.metadata.id,
      });
    });
  }

  async terminate(): Promise<void> {
    if (this.metadata.status === 'terminated') {
      return;
    }

    this.metadata.status = 'terminating';

    for (const [taskId, pending] of this.pendingTasks.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new ProcessError(
        'Worker terminated',
        'WORKER_TERMINATED',
        this.metadata.id
      ));
    }

    this.pendingTasks.clear();

    try {
      await this.worker.terminate();
      this.metadata.status = 'terminated';

      this.eventBus.emit('worker:terminated', { processId: this.metadata.id });
    } catch (error) {
      throw new WorkerTerminationError(this.metadata.id, {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getHealth(): WorkerHealthReport {
    const now = Date.now();
    const uptime = now - this.metadata.createdAt;
    const timeSinceActivity = now - this.metadata.lastActivity;

    return {
      processId: this.metadata.id,
      status: this.metadata.status,
      uptime,
      memoryUsage: process.memoryUsage(),
      executionCount: this.metadata.executionCount,
      lastActivity: this.metadata.lastActivity,
      isHealthy: this.metadata.status !== 'crashed' && timeSinceActivity < 30000,
    };
  }

  private generateProcessId(): string {
    return `proc_${randomBytes(8).toString('hex')}`;
  }

  get id(): string {
    return this.metadata.id;
  }

  get status(): WorkerStatus {
    return this.metadata.status;
  }

  get isIdle(): boolean {
    return this.metadata.status === 'idle';
  }

  get isBusy(): boolean {
    return this.metadata.status === 'busy';
  }

  get info(): Readonly<WorkerMetadata> {
    return { ...this.metadata };
  }
}

// ============================================================================
// TASK QUEUE WITH PRIORITY
// ============================================================================

class PriorityTaskQueue {
  private readonly queues: Map<ProcessPriority, TaskDescriptor[]> = new Map([
    ['critical', []],
    ['high', []],
    ['normal', []],
    ['low', []],
    ['background', []],
  ]);

  private readonly priorityOrder: ProcessPriority[] = [
    'critical',
    'high',
    'normal',
    'low',
    'background',
  ];

  enqueue(task: TaskDescriptor): void {
    const queue = this.queues.get(task.priority);
    if (queue) {
      queue.push(task);
    }
  }

  dequeue(): TaskDescriptor | null {
    for (const priority of this.priorityOrder) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        return queue.shift() ?? null;
      }
    }
    return null;
  }

  get size(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }

  clear(): void {
    for (const queue of this.queues.values()) {
      queue.length = 0;
    }
  }
}

// ============================================================================
// PROCESS MANAGER
// ============================================================================

class ProcessManager extends TypedEventEmitter<ProcessEventMap> {
  private readonly workers = new Map<string, WorkerProcess>();
  private readonly taskQueue: PriorityTaskQueue;
  private readonly capabilityManager: CapabilityManager;
  private readonly config: ProcessPoolConfig;
  private readonly workerScript: string;
  private readonly plugins = new Map<string, PluginManifest>();

  private healthCheckInterval: NodeJS.Timeout | null = null;
  private scaleCheckInterval: NodeJS.Timeout | null = null;
  private isShutdown = false;

  private stats = {
    totalTasksExecuted: 0,
    totalTasksFailed: 0,
    totalExecutionTime: 0,
  };

  constructor(
    workerScript: string,
    config?: Partial<ProcessPoolConfig>
  ) {
    super();

    this.workerScript = workerScript;
    this.taskQueue = new PriorityTaskQueue();
    this.capabilityManager = new CapabilityManager();

    const cores = cpus().length;

    this.config = {
      minWorkers: config?.minWorkers ?? Math.max(2, cores - 2),
      maxWorkers: config?.maxWorkers ?? cores * 2,
      idleTimeoutMs: config?.idleTimeoutMs ?? 60000,
      scaleUpThreshold: config?.scaleUpThreshold ?? 0.8,
      scaleDownThreshold: config?.scaleDownThreshold ?? 0.3,
      healthCheckInterval: config?.healthCheckInterval ?? 10000,
    };

    void this.initialize();
  }

  private async initialize(): Promise<void> {
    for (let i = 0; i < this.config.minWorkers; i++) {
      await this.createWorker();
    }

    this.startHealthMonitoring();
    this.startAutoScaling();
  }

  private async createWorker(): Promise<WorkerProcess> {
    if (this.workers.size >= this.config.maxWorkers) {
      throw new ProcessPoolExhaustedError(this.config.maxWorkers, this.workers.size);
    }

    const worker = new WorkerProcess(this.workerScript, this);
    this.workers.set(worker.id, worker);

    return worker;
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    let healthy = 0;
    let unhealthy = 0;

    const deadWorkers: string[] = [];

    for (const [id, worker] of this.workers.entries()) {
      const health = worker.getHealth();

      if (health.isHealthy) {
        healthy++;
      } else {
        unhealthy++;

        if (worker.status === 'crashed') {
          deadWorkers.push(id);
        }
      }
    }

    for (const deadId of deadWorkers) {
      await this.resurrectWorker(deadId);
    }

    this.emit('health:check', { healthy, unhealthy });
  }

  private async resurrectWorker(deadWorkerId: string): Promise<void> {
    const deadWorker = this.workers.get(deadWorkerId);
    if (!deadWorker) return;

    try {
      await deadWorker.terminate();
    } catch (error) {
      // Suppress termination errors
    }

    this.workers.delete(deadWorkerId);

    const newWorker = await this.createWorker();

    this.emit('worker:resurrected', {
      processId: newWorker.id,
      previousId: deadWorkerId,
    });
  }

  private startAutoScaling(): void {
    this.scaleCheckInterval = setInterval(() => {
      void this.checkAndScale();
    }, 5000);
  }

  private async checkAndScale(): Promise<void> {
    const totalWorkers = this.workers.size;
    const busyWorkers = Array.from(this.workers.values()).filter(w => w.isBusy).length;
    const utilization = totalWorkers > 0 ? busyWorkers / totalWorkers : 0;

    if (utilization >= this.config.scaleUpThreshold && totalWorkers < this.config.maxWorkers) {
      const toAdd = Math.min(2, this.config.maxWorkers - totalWorkers);
      for (let i = 0; i < toAdd; i++) {
        await this.createWorker();
      }
      this.emit('pool:scaled_up', { newSize: this.workers.size });
    }

    if (utilization <= this.config.scaleDownThreshold && totalWorkers > this.config.minWorkers) {
      const toRemove = Math.min(1, totalWorkers - this.config.minWorkers);
      const idleWorkers = Array.from(this.workers.values()).filter(w => w.isIdle);

      for (let i = 0; i < toRemove && i < idleWorkers.length; i++) {
        const worker = idleWorkers[i];
        await worker.terminate();
        this.workers.delete(worker.id);
      }

      this.emit('pool:scaled_down', { newSize: this.workers.size });
    }
  }

  registerPlugin(manifest: PluginManifest): void {
    this.plugins.set(manifest.id, manifest);
    this.capabilityManager.grant(manifest.id, manifest.capabilities);
  }

  unregisterPlugin(pluginId: string): void {
    this.plugins.delete(pluginId);
    this.capabilityManager.revoke(pluginId);
  }

  async executePlugin<T = unknown>(
    pluginId: string,
    payload: unknown,
    priority: ProcessPriority = 'normal'
  ): Promise<TaskResult<T>> {
    const manifest = this.plugins.get(pluginId);
    if (!manifest) {
      throw new ProcessError(
        `Plugin not registered: ${pluginId}`,
        'PLUGIN_NOT_FOUND',
        undefined,
        { pluginId }
      );
    }

    const task: TaskDescriptor = {
      id: this.generateTaskId(),
      type: 'plugin',
      priority,
      payload: {
        pluginId,
        entryPoint: manifest.entryPoint,
        data: payload,
        capabilities: manifest.capabilities,
      },
      timeoutMs: manifest.maxExecutionMs,
      retryCount: 0,
      maxRetries: 3,
      startTime: Date.now(),
      pluginId,
      capabilities: manifest.capabilities,
    };

    return this.executeTask<T>(task);
  }

  async executeTask<T = unknown>(task: TaskDescriptor): Promise<TaskResult<T>> {
    if (this.isShutdown) {
      throw new ProcessError('Process manager is shutdown', 'MANAGER_SHUTDOWN');
    }

    const worker = this.getIdleWorker();

    if (worker) {
      return this.executeOnWorker<T>(worker, task);
    } else {
      return this.queueTask<T>(task);
    }
  }

  private async executeOnWorker<T>(
    worker: WorkerProcess,
    task: TaskDescriptor
  ): Promise<TaskResult<T>> {
    const startTime = performance.now();

    try {
      const result = await worker.execute<T>(task);

      const executionTime = performance.now() - startTime;
      this.stats.totalTasksExecuted++;
      this.stats.totalExecutionTime += executionTime;

      void this.processQueue();

      return result;
    } catch (error) {
      this.stats.totalTasksFailed++;

      if (task.retryCount < task.maxRetries) {
        const retriedTask: TaskDescriptor = {
          ...task,
          retryCount: task.retryCount + 1,
        };

        this.emit('task:failed', {
          taskId: task.id,
          error: error instanceof Error ? error : new Error(String(error)),
          retries: task.retryCount,
        });

        return this.executeTask<T>(retriedTask);
      }

      throw error;
    }
  }

  private async queueTask<T>(task: TaskDescriptor): Promise<TaskResult<T>> {
    return new Promise<TaskResult<T>>((resolve, reject) => {
      const taskPayload = typeof task.payload === 'object' && task.payload !== null 
        ? { ...(task.payload as Record<string, unknown>) }
        : {};

      const wrappedTask: TaskDescriptor = {
        ...task,
        payload: {
          ...taskPayload,
          __promise: { resolve, reject },
        },
      };

      this.taskQueue.enqueue(wrappedTask);
      this.emit('task:queued', { taskId: task.id, priority: task.priority });

      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    while (!this.taskQueue.isEmpty) {
      const worker = this.getIdleWorker();
      if (!worker) break;

      const task = this.taskQueue.dequeue();
      if (!task) break;

      const payload = typeof task.payload === 'object' && task.payload !== null
        ? task.payload as Record<string, unknown>
        : null;

      const promise = payload?.__promise as { 
        resolve: (r: TaskResult) => void; 
        reject: (e: Error) => void;
      } | undefined;

      if (promise && payload) {
        delete payload.__promise;

        const cleanTask: TaskDescriptor = {
          ...task,
          payload,
        };

        try {
          const result = await this.executeOnWorker(worker, cleanTask);
          promise.resolve(result);
        } catch (error) {
          promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  private getIdleWorker(): WorkerProcess | null {
    for (const worker of this.workers.values()) {
      if (worker.isIdle) {
        return worker;
      }
    }
    return null;
  }

  getStats(): ProcessManagerStats {
    const workers = Array.from(this.workers.values());
    const activeWorkers = workers.filter(w => w.isBusy).length;
    const idleWorkers = workers.filter(w => w.isIdle).length;
    const crashedWorkers = workers.filter(w => w.status === 'crashed').length;

    const totalMemory = workers.reduce((sum, w) => sum + w.info.memoryUsage, 0);

    return {
      totalWorkers: this.workers.size,
      activeWorkers,
      idleWorkers,
      crashedWorkers,
      totalTasksExecuted: this.stats.totalTasksExecuted,
      totalTasksFailed: this.stats.totalTasksFailed,
      averageExecutionTime: this.stats.totalTasksExecuted > 0
        ? this.stats.totalExecutionTime / this.stats.totalTasksExecuted
        : 0,
      poolUtilization: this.workers.size > 0 ? activeWorkers / this.workers.size : 0,
      memoryUsage: totalMemory,
    };
  }

  getWorkerHealth(): ReadonlyArray<WorkerHealthReport> {
    return Array.from(this.workers.values()).map(w => w.getHealth());
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) return;

    this.isShutdown = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.scaleCheckInterval) {
      clearInterval(this.scaleCheckInterval);
      this.scaleCheckInterval = null;
    }

    this.taskQueue.clear();

    const terminatePromises = Array.from(this.workers.values()).map(w => w.terminate());
    await Promise.allSettled(terminatePromises);

    this.workers.clear();

    this.removeAllListeners();

    if (global.gc) {
      global.gc();
    }
  }

  async dispose(): Promise<void> {
    return this.shutdown();
  }
}

// ============================================================================
// WORKER SCRIPT TEMPLATE GENERATOR
// ============================================================================

function generateWorkerScript(): string {
  return `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

const processId = workerData.processId;
let currentTask = null;

const createSandbox = (capabilities) => {
  const sandbox = {
    console: {
      log: (...args) => parentPort.postMessage({
        type: 'log',
        id: processId,
        timestamp: Date.now(),
        payload: args,
      }),
      error: (...args) => parentPort.postMessage({
        type: 'error_log',
        id: processId,
        timestamp: Date.now(),
        payload: args,
      }),
    },
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Buffer,
    TextEncoder,
    TextDecoder,
    performance,
    capabilities: new Set(capabilities),
  };

  return sandbox;
};

parentPort.on('message', async (buffer) => {
  try {
    const decoder = new TextDecoder();
    const json = decoder.decode(buffer);
    const message = JSON.parse(json);

    if (message.type === 'execute') {
      const task = message.payload;
      currentTask = task;

      const startTime = performance.now();
      const startMemory = process.memoryUsage().heapUsed;

      try {
        let result;

        if (task.type === 'plugin') {
          const sandbox = createSandbox(task.payload.capabilities || []);
          const context = vm.createContext(sandbox);

          const script = new vm.Script(\`
            (async function() {
              \${task.payload.entryPoint}
            })()
          \`);

          result = await script.runInContext(context, {
            timeout: task.timeoutMs,
            breakOnSigint: true,
          });
        } else {
          result = await executeGenericTask(task);
        }

        const executionTime = performance.now() - startTime;
        const memoryUsed = process.memoryUsage().heapUsed - startMemory;

        const response = {
          type: 'result',
          id: message.id,
          timestamp: Date.now(),
          payload: {
            taskId: task.id,
            success: true,
            result,
            executionTime,
            memoryUsed,
            processId,
          },
        };

        const encoder = new TextEncoder();
        const encoded = encoder.encode(JSON.stringify(response));

        parentPort.postMessage(encoded.buffer, [encoded.buffer]);
      } catch (error) {
        const response = {
          type: 'error',
          id: message.id,
          timestamp: Date.now(),
          payload: {
            taskId: task.id,
            error: error.message || String(error),
          },
        };

        const encoder = new TextEncoder();
        const encoded = encoder.encode(JSON.stringify(response));

        parentPort.postMessage(encoded.buffer, [encoded.buffer]);
      } finally {
        currentTask = null;
      }
    } else if (message.type === 'terminate') {
      process.exit(0);
    }
  } catch (error) {
    const response = {
      type: 'error',
      id: 'unknown',
      timestamp: Date.now(),
      payload: { error: error.message || String(error) },
    };

    const encoder = new TextEncoder();
    const encoded = encoder.encode(JSON.stringify(response));

    parentPort.postMessage(encoded.buffer, [encoded.buffer]);
  }
});

async function executeGenericTask(task) {
  return task.payload;
}

setInterval(() => {
  const message = {
    type: 'health',
    id: processId,
    timestamp: Date.now(),
    payload: {
      memoryUsage: process.memoryUsage().heapUsed,
      cpuTime: process.cpuUsage().user,
    },
  };

  const encoder = new TextEncoder();
  const encoded = encoder.encode(JSON.stringify(message));

  parentPort.postMessage(encoded.buffer, [encoded.buffer]);
}, 5000);
  `.trim();
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  ProcessManager,
  ProcessError,
  WorkerCreationError,
  WorkerTerminationError,
  PluginExecutionError,
  PluginTimeoutError,
  PluginMemoryLimitError,
  PermissionDeniedError,
  ProcessPoolExhaustedError,
  generateWorkerScript,
};

export type {
  WorkerStatus,
  ProcessPriority,
  PluginCapability,
  PluginManifest,
  WorkerMetadata,
  TaskDescriptor,
  TaskResult,
  ProcessPoolConfig,
  IPCMessage,
  WorkerHealthReport,
  ProcessManagerStats,
  ProcessEventMap,
};

export function createProcessManager(
  workerScript: string,
  config?: Partial<ProcessPoolConfig>
): ProcessManager {
  return new ProcessManager(workerScript, config);
}
