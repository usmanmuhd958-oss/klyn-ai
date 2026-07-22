/**
 * KLYN AI OS - Process Executor
 * Secure process execution with resource limits
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import type { ExecutionContext, ExecutionResult } from '../0.kernel/types.ts';

export class ProcessExecutor {
  [key: string]: any;
  private activeProcesses = new Map<string, any>();

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
   * Execute shell command (Termux-safe)
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    context: Partial<ExecutionContext> = {}
  ): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();

    return new Promise((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const child = spawn(command, args, {
        cwd: context.workingDirectory || process.cwd(),
        env: { ...process.env, ...context.environment },
        timeout: context.timeout || 30000,
        shell: true,
      });

      this.activeProcesses.set(executionId, child);

      child.stdout?.on('data', (data) => stdout.push((data as any).toString()));
      child.stderr?.on('data', (data) => stderr.push((data as any).toString()));

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
      }, context.timeout || 30000);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(executionId);

        resolve({
          success: code === 0,
          exitCode: code || 0,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
          duration: Date.now() - startTime,
        });
      });

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
   * Kill process by execution ID
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
}
