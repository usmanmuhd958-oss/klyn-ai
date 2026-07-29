// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * KLYN AI OS - Telemetry System
 * Real-time runtime monitoring and event streaming
 */

// @ts-ignore
import { kernelBus } from '../0.kernel/bus.ts';
// @ts-ignore
import { ErrorDetector } from './error_detector.ts';
// @ts-ignore
import { DiagnosticGenerator } from './diagnostics.ts';
import type { ExecutionResult, DiagnosticPayload } from '../0.kernel/types.ts';

export interface TelemetryMetrics {
  totalExecutions: number;
  failedExecutions: number;
  errorsDetected: number;
  averageExecutionTime: number;
  errorsByType: Record<string, number>;
}

export class TelemetrySystem {
  [key: string]: any;
  private errorDetector: ErrorDetector;
  private diagnosticGenerator: DiagnosticGenerator;
  private metrics: TelemetryMetrics = {
    totalExecutions: 0,
    failedExecutions: 0,
    errorsDetected: 0,
    averageExecutionTime: 0,
    errorsByType: {},
  };

  private isMonitoring = false;

  constructor() {
    this.errorDetector = new ErrorDetector();
    this.diagnosticGenerator = new DiagnosticGenerator();
  }

  /**
   * Start monitoring runtime events
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    console.log('[Telemetry] 📡 Starting monitoring...');

    // Monitor execution completions
    kernelBus.subscribe('runtime.execution.completed', async (event) => {
      await this.handleExecutionCompleted((event as any).payload);
    });

    // Monitor execution failures
    kernelBus.subscribe('runtime.execution.failed', async (event) => {
      await this.handleExecutionFailed((event as any).payload);
    });

    // Monitor stderr output
    kernelBus.subscribe('runtime.stderr', async (event) => {
      await this.handleStderr((event as any).payload);
    });

    this.isMonitoring = true;
    console.log('[Telemetry] ✅ Monitoring active');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    console.log('[Telemetry] 🛑 Monitoring stopped');
  }

  private async handleExecutionCompleted(payload: any): Promise<void> {
    this.metrics.totalExecutions++;

    const result: ExecutionResult = payload.result;
    this.updateAverageExecutionTime(result.duration);

    // Check for errors even in "successful" executions
    if (this.errorDetector.hasErrors(result.stderr || result.stdout)) {
      await this.handlePotentialError(payload.executionId, result);
    }
  }

  private async handleExecutionFailed(payload: any): Promise<void> {
    this.metrics.totalExecutions++;
    this.metrics.failedExecutions++;

    const result: ExecutionResult = payload.result;
    await this.handlePotentialError(payload.executionId, result);
  }

  private async handleStderr(payload: any): Promise<void> {
    const { output } = payload;

    // Real-time error detection
    if (this.errorDetector.hasErrors(output)) {
      console.warn('[Telemetry] ⚠️  Error detected in stderr stream');
    }
  }

  private async handlePotentialError(
    executionId: string,
    result: ExecutionResult
  ): Promise<void> {
    const errorOutput = result.stderr || result.stdout;
    const errors = this.errorDetector.detect(errorOutput);

    if (errors.length === 0) return;

    this.metrics.errorsDetected += errors.length;

    // Track error types
    for (const error of errors) {
      this.metrics.errorsByType[error.type] = 
        (this.metrics.errorsByType[error.type] || 0) + 1;
    }

    // Get execution context from event history
    const executionEvents = kernelBus.getEventChain(executionId);
    const startEvent = executionEvents.find(e => 
      e.type === 'runtime.execution.started'
    );

    if (!startEvent) {
      console.warn('[Telemetry] Could not find execution start event');
      return;
    }

    const filePath = startEvent.payload.filePath;

    // Generate diagnostic
    const diagnostic = await this.diagnosticGenerator.generate(
      executionId,
      filePath,
      result
    );

    if (diagnostic) {
      console.log('\n' + this.diagnosticGenerator.formatReport(diagnostic));

      // Publish error detected event
      kernelBus.publish(
        'error.detected',
        { executionId, diagnostic },
        'telemetry',
        executionId
      );

      // Generate enriched diagnostic
      const enriched = await this.diagnosticGenerator.enrichDiagnostic(diagnostic);

      kernelBus.publish(
        'error.diagnosed',
        { executionId, diagnostic: enriched },
        'telemetry',
        executionId
      );
    }
  }

  private updateAverageExecutionTime(duration: number): void {
    const total = this.metrics.totalExecutions;
    this.metrics.averageExecutionTime = 
      (this.metrics.averageExecutionTime * (total - 1) + duration) / total;
  }

  /**
   * Get metrics
   */
  getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }

  /**
   * Generate metrics report
   */
  generateReport(): string {
    const m = this.metrics;
    const failureRate = ((m.failedExecutions / m.totalExecutions) * 100).toFixed(1);

    return `
╔══════════════════════════════════════════════════╗
║         TELEMETRY METRICS REPORT                 ║
╚══════════════════════════════════════════════════╝

Total Executions:    ${m.totalExecutions}
Failed Executions:   ${m.failedExecutions} (${failureRate}%)
Errors Detected:     ${m.errorsDetected}
Avg Execution Time:  ${m.averageExecutionTime.toFixed(0)}ms

Errors by Type:
${Object.entries(m.errorsByType)
  .sort(([, a], [, b]) => b - a)
  .map(([type, count]) => `  ${type.padEnd(25)} ${count}`)
  .join('\n') || '  (none)'}
    `.trim();
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics = {
      totalExecutions: 0,
      failedExecutions: 0,
      errorsDetected: 0,
      averageExecutionTime: 0,
      errorsByType: {},
    };
  }
}
