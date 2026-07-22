/**
 * KLYN AI OS - Termux Runtime Sandbox
 * Secure execution environment with monitoring
 */

import { kernelBus } from '../0.kernel/bus.ts';
import { ProcessExecutor } from './executor.ts';
import type { ExecutionContext, ExecutionResult } from '../0.kernel/types.ts';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';

export interface RuntimeConfig {
  workingDirectory: string;
  timeout?: number;
  memoryLimit?: number;
  allowedPaths?: string[];
}

export class TermuxRuntime {
  private executor: ProcessExecutor;
  private config: RuntimeConfig;
  private executionHistory: Map<string, ExecutionResult> = new Map();

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.executor = new ProcessExecutor();
  }

  /**
   * Execute TypeScript/JavaScript file
   */
  async execute(
    filePath: string,
    context: Partial<ExecutionContext> = {}
  ): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const absolutePath = path.resolve(this.config.workingDirectory, filePath);

    // Security check - ensure file is in allowed paths
    if (!this.isPathAllowed(absolutePath)) {
      throw new Error(`Access denied: ${absolutePath} is outside allowed paths`);
    }

    // Verify file exists
    try {
      await fs.access(absolutePath);
    } catch {
      throw new Error(`File not found: ${absolutePath}`);
    }

    console.log(`[Runtime] 🚀 Executing: ${filePath}`);

    // Publish execution start event
    kernelBus.publish(
      'runtime.execution.started',
      { executionId, filePath: absolutePath },
      'runtime',
      executionId
    );

    try {
      // Execute with monitoring
      const result = await this.executor.executeNodeFile(absolutePath, {
        ...context,
        executionId,
        workingDirectory: this.config.workingDirectory,
        timeout: context.timeout || this.config.timeout,
        memoryLimit: context.memoryLimit || this.config.memoryLimit,
      });

      // Stream stdout events
      if (result.stdout) {
        kernelBus.publish(
          'runtime.stdout',
          { executionId, output: result.stdout },
          'runtime',
          executionId
        );
      }

      // Stream stderr events
      if (result.stderr) {
        kernelBus.publish(
          'runtime.stderr',
          { executionId, output: result.stderr },
          'runtime',
          executionId
        );
      }

      // Store in history
      this.executionHistory.set(executionId, result);

      // Publish completion event
      if (result.success) {
        console.log(`[Runtime] ✅ Success (${result.duration}ms)`);
        kernelBus.publish(
          'runtime.execution.completed',
          { executionId, result },
          'runtime',
          executionId
        );
      } else {
        console.error(`[Runtime] ❌ Failed (exit ${result.exitCode})`);
        kernelBus.publish(
          'runtime.execution.failed',
          { executionId, result },
          'runtime',
          executionId
        );
      }

      return result;
    } catch (error) {
      console.error(`[Runtime] 💥 Error:`, error);
      
      const result: ExecutionResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: (error as Error).message,
        duration: 0,
        error: error as Error,
      };

      kernelBus.publish(
        'runtime.execution.failed',
        { executionId, result, error },
        'runtime',
        executionId
      );

      return result;
    }
  }

  /**
   * Execute with test validation
   */
  async executeWithTests(
    filePath: string,
    testFilePath?: string
  ): Promise<{ main: ExecutionResult; test?: ExecutionResult }> {
    const mainResult = await this.execute(filePath);

    if (!testFilePath) {
      return { main: mainResult };
    }

    // If main execution failed, don't run tests
    if (!mainResult.success) {
      return { main: mainResult };
    }

    const testResult = await this.execute(testFilePath);

    return { main: mainResult, test: testResult };
  }

  /**
   * Execute command in sandbox
   */
  async executeCommand(
    command: string,
    args: string[] = []
  ): Promise<ExecutionResult> {
    const executionId = randomUUID();

    console.log(`[Runtime] 📟 Command: ${command} ${args.join(' ')}`);

    const result = await this.executor.executeCommand(command, args, {
      executionId,
      workingDirectory: this.config.workingDirectory,
      timeout: this.config.timeout,
    });

    return result;
  }

  /**
   * Get execution history
   */
  getHistory(): ExecutionResult[] {
    return Array.from(this.executionHistory.values());
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): ExecutionResult | undefined {
    return this.executionHistory.get(executionId);
  }

  private isPathAllowed(absolutePath: string): boolean {
    if (!this.config.allowedPaths || this.config.allowedPaths.length === 0) {
      return true;
    }

    return this.config.allowedPaths.some(allowedPath => 
      absolutePath.startsWith(path.resolve(allowedPath))
    );
  }
}
