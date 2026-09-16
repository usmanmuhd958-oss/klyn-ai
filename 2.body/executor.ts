/**
 * KLYN AI OS - Process Executor
 * Secure process execution with resource limits
 *
 * Phase 2: shell commands now run on long-lived persistent stdio slots from
 * the ShellPool instead of spawning a fresh OS process per step. Verified pure
 * commands additionally hit the CommandPlanCache (hash dedup) and skip shell
 * execution entirely. Node-file execution keeps its spawn-based path.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import type { ExecutionContext, ExecutionResult } from '../0.kernel/types.ts';
import { ShellPool } from './pool/pool.ts';
import { ShellSlot } from './pool/shell-slot.ts';
import { CommandPlanCache } from './pool/plan-cache.ts';

export class ProcessExecutor {
  [key: string]: any;
  private activeProcesses = new Map<string, any>();
  private shellPool: ShellPool;
  private planCache: CommandPlanCache;

  constructor() {
    this.shellPool = new ShellPool({ maxSlots: 4 });
    this.planCache = new CommandPlanCache();
  }

  /**
   * Execute Node.js file
   */
  async executeNodeFile(
    filePath: string,
    context: Partial<ExecutionContext> = {}
  ): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();

    const ctx: ExecutionContext = {
      executionId,
      filePath,
      workingDirectory: context.workingDirectory || process.cwd(),
      environment: { ...process.env, ...context.environment },
      timeout: context.timeout || 30000,
      memoryLimit: context.memoryLimit || 512 * 1024 * 1024, // 512MB
    };

    return new Promise((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      // Spawn Node.js process
      const child = spawn('node', [filePath], {
        cwd: ctx.workingDirectory,
        env: ctx.environment,
        timeout: ctx.timeout,
        // Termux-compatible settings
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(executionId, child);

      // Capture stdout
      child.stdout?.on('data', (data) => {
        stdout.push((data as any).toString());
      });

      // Capture stderr
      child.stderr?.on('data', (data) => {
        stderr.push((data as any).toString());
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000);
      }, ctx.timeout);

      // Handle completion
      child.on('close', (code) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(executionId);

        const duration = Date.now() - startTime;

        resolve({
          success: code === 0,
          exitCode: code || 0,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
          duration,
        });
      });

      // Handle errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(executionId);

        resolve({
          success: false,
          exitCode: 1,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
          duration: Date.now() - startTime,
          error,
        });
      });
    });
  }

  /**
   * Execute shell command on a persistent stdio slot (Phase 2).
   * Set `context.cacheable = true` for verified pure commands to enable
   * plan-cache dedup (identical command + cwd + env skip shell execution).
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    context: Partial<ExecutionContext> & { cacheable?: boolean } = {}
  ): Promise<ExecutionResult> {
    const executionId = context.executionId || randomUUID();
    const startTime = Date.now();
    const cwd = context.workingDirectory || process.cwd();
    const full = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    const cacheable = context.cacheable === true;

    // Plan-cache fast path — verified pure commands, zero shell work.
    if (cacheable) {
      const key = this.planCache.key(full, cwd, context.environment);
      const cached = this.planCache.get(key);
      if (cached) {
        const hit: ExecutionResult & { cached?: boolean } = {
          success: cached.exitCode === 0,
          exitCode: cached.exitCode,
          stdout: cached.stdout,
          stderr: cached.stderr,
          duration: 0,
          cached: true,
        };
        return hit;
      }
    }

    let slot: ShellSlot;
    try {
      slot = await this.shellPool.acquire(cwd);
    } catch (error) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
        duration: 0,
        error: error as Error,
      };
    }

    try {
      const result = await slot.run(full, {
        env: context.environment,
        timeoutMs: context.timeout || 30000,
      });

      const execResult: ExecutionResult & { cached?: boolean } = {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.durationMs,
        error: result.error ? new Error(result.error) : undefined,
      };

      if (cacheable && execResult.success) {
        this.planCache.set({
          key: this.planCache.key(full, cwd, context.environment),
          command: full,
          cwd,
          envKey: JSON.stringify(context.environment ?? {}),
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          durationMs: result.durationMs,
          createdAt: Date.now(),
          hitCount: 0,
        });
      }

      return execResult;
    } finally {
      this.shellPool.release(slot);
    }
  }

  /**
   * Kill process by execution ID (node-file executions only; shell slot
   * timeouts are handled inside the slot itself).
   */
  killProcess(executionId: string): boolean {
    const process = this.activeProcesses.get(executionId);
    if (process) {
      process.kill('SIGTERM');
      this.activeProcesses.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Get active process count
   */
  getActiveCount(): number {
    return this.activeProcesses.size;
  }

  /** Pool + cache stats for the runtime health surface. */
  getPoolStats() {
    return {
      pool: this.shellPool.getStats(),
      planCache: this.planCache.getStats(),
    };
  }

  /** Tear down all persistent shell slots. */
  dispose(): void {
    void this.shellPool.dispose();
  }
}
