/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 04: UniversalExecutionFabric
 * File: genesis/v670/components/UniversalExecutionFabric.ts
 * Version: 1.0.0
 *
 * The execution plane of the V670 runtime. Wires the real body layers:
 *   - 2.body/runtime.ts (TermuxRuntime — sandboxed execution)
 *   - 2.body/executor.ts (ProcessExecutor — process primitives)
 *   - 2.body/supervisor.ts (Supervisor — timeout + retry watchdog)
 *   - 1.bridge/src/kernel_bridge.ts (Rust KernelBridge — optional, degrades)
 *
 * Every execution is sandboxed, supervised, and emitted on the event bus
 * (runtime.execution.started/completed/failed) — bridged into the 0.kernel bus.
 * =============================================================================
 */

import { TermuxRuntime } from '../../../2.body/runtime.ts';
import { ProcessExecutor } from '../../../2.body/executor.js';
import { Supervisor, type SupervisionRecord } from '../../../2.body/supervisor.js';
import { KernelBridge } from '../../../1.bridge/src/kernel_bridge.js';
import type { ExecutionContext, ExecutionResult } from '../../../0.kernel/types.js';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';

export interface ExecuteOptions {
  filePath?: string;
  command?: string;
  args?: string[];
  context?: Partial<ExecutionContext>;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface FabricExecutionReport {
  supervised: SupervisionRecord;
  result: ExecutionResult | null;
}

export class UniversalExecutionFabric implements V670Module {
  [key: string]: any;
  readonly id = 'universal-fabric';
  readonly name = 'Universal Execution Fabric';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private runtime: TermuxRuntime | null = null;
  private supervisor: Supervisor;
  private nativeBridge: { getStats: () => { processed: number; pending: number } } | null = null;
  private executions = 0;
  private failures = 0;
  private totalDurationMs = 0;

  constructor() {
    this.supervisor = new Supervisor({ timeoutMs: 30_000, maxAttempts: 2, backoffMs: 200 });
  }

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;
    this.runtime = new TermuxRuntime({
      workingDirectory: ctx.config.workingDirectory,
      timeout: ctx.config.tickMs * 60,
      allowedPaths: [ctx.config.workingDirectory],
    });

    // Optional Rust bridge — degrades when libklyn_kernel.so is not built.
    if (ctx.config.native) {
      try {
        const bridge = new KernelBridge();
        this.nativeBridge = {
          getStats: () => {
            try {
              return bridge.getStats();
            } catch {
              return { processed: -1, pending: -1 };
            }
          },
        };
        ctx.logger.info('Rust kernel bridge online');
      } catch {
        this.nativeBridge = null;
        ctx.logger.debug('Rust kernel bridge unavailable — JS execution mode');
      }
    }

    // Surface execution events for healing loops.
    this.ctx.subscribe('runtime.execution.failed', (event) => {
      this.failures++;
      void event;
    });

    // Consume dispatches from the InfiniteRuntimeOrchestrator (via the ring).
    this.ctx.subscribe('orchestrator.dispatch', (event) => {
      const options = event.payload as ExecuteOptions;
      if (options && (options.filePath || options.command !== undefined)) {
        void this.execute(options).catch((err) => {
          this.lastError = (err as Error).message;
        });
      }
    });
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';
    ctx.logger.info('universal execution fabric online');
  }

  /**
   * Execute a task: a file (TermuxRuntime.execute) or a command
   * (TermuxRuntime.executeCommand), wrapped in the Supervisor watchdog.
   */
  public async execute(options: ExecuteOptions): Promise<FabricExecutionReport> {
    if (!this.runtime) throw new Error('execution fabric not registered');

    const started = Date.now();
    this.executions++;
    const executionId = (options.context?.executionId as string) ?? undefined;

    this.ctx?.publish('runtime.execution.started', {
      filePath: options.filePath,
      command: options.command,
      executionId,
    }, this.id, executionId);

    const report = await this.supervisor.supervise(
      options.filePath ?? options.command ?? 'anonymous-task',
      async () => {
        if (options.filePath) {
          return this.runtime!.execute(options.filePath, options.context ?? {});
        }
        if (options.command !== undefined) {
          return this.runtime!.executeCommand(options.command, options.args ?? []);
        }
        return {
          success: false,
          exitCode: 2,
          stdout: '',
          stderr: 'no filePath or command provided',
          duration: 0,
        } as ExecutionResult;
      },
      { timeoutMs: options.timeoutMs, maxAttempts: options.maxAttempts }
    );

    const result = report.result;
    if (result) {
      this.totalDurationMs += result.duration;
      if (!result.success) this.failures++;
      this.ctx?.publish(
        result.success ? 'runtime.execution.completed' : 'runtime.execution.failed',
        { executionId, result },
        this.id,
        executionId
      );
    }

    return { supervised: report, result };
  }

  public async executeCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const report = await this.execute({ command, args });
    return report.result ?? {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'no result',
      duration: 0,
    };
  }

  public async executeFile(filePath: string, context: Partial<ExecutionContext> = {}): Promise<ExecutionResult> {
    const report = await this.execute({ filePath, context });
    return report.result ?? {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'no result',
      duration: 0,
    };
  }

  public kill(executionId: string): boolean {
    try {
      return this.runtime?.['executor']?.killProcess?.(executionId) ?? false;
    } catch {
      return false;
    }
  }

  public getSupervisor(): Supervisor {
    return this.supervisor;
  }

  public getNativeStats() {
    return this.nativeBridge?.getStats() ?? null;
  }

  public async stop(): Promise<void> {
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    this.status = 'stopped';
  }

  public metrics(): ModuleMetrics {
    const avgMs = this.executions > 0 ? Math.round(this.totalDurationMs / this.executions) : 0;
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      { executions: this.executions, failures: this.failures, supervisorAttempts: this.supervisor.getStats().totalAttempts },
      {
        avgDurationMs: avgMs,
        nativeBridge: this.nativeBridge ? 1 : 0,
        supervisedRecords: this.supervisor.getStats().recordsRetained,
      },
      this.lastError
    );
  }
}

export default UniversalExecutionFabric;
