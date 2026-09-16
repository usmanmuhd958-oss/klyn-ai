/**
 * KLYN AI OS - Kernel Layer Types
 * Event-driven system bus definitions
 */

export type EventType =
  | 'runtime.execution.started'
  | 'runtime.execution.completed'
  | 'runtime.execution.failed'
  | 'runtime.stdout'
  | 'runtime.stderr'
  | 'error.detected'
  | 'error.diagnosed'
  | 'patch.generated'
  | 'patch.applied'
  | 'patch.failed'
  | 'patch.rolled_back'
  | 'healing.started'
  | 'healing.completed'
  | 'healing.failed'
  | 'telemetry.metric'
  | 'system.health_check'
  | 'system.ok'
  | 'system.error'
  | 'system.panic'
  | 'system.exit';

export interface KernelEvent {
  id: string;
  type: EventType;
  timestamp: Date;
  source: string;
  payload: any;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export interface EventHandler {
  (event: KernelEvent): void | Promise<void>;
}

export interface EventSubscription {
  id: string;
  eventType: EventType | '*';
  handler: EventHandler;
  priority?: number;
}

export interface ExecutionContext {
  executionId: string;
  filePath: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  timeout?: number;
  memoryLimit?: number;
}

export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  memoryUsed?: number;
  error?: Error;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface DiagnosticPayload {
  errorInfo: ErrorInfo;
  context: {
    executionId: string;
    filePath: string;
    sourceCode: string;
    recentOutput: string[];
    environment: Record<string, string>;
  };
  stackTrace: string;
  relatedFiles?: string[];
  timestamp: Date;
}

export interface CodePatch {
  id: string;
  filePath: string;
  original: string;
  patched: string;
  changes: Change[];
  validation: {
    syntaxValid: boolean;
    errors: string[];
  };
  metadata: {
    generatedBy: string;
    reason: string;
    timestamp: Date;
  };
}

export interface Change {
  type: 'insert' | 'delete' | 'replace';
  line: number;
  column?: number;
  original?: string;
  replacement?: string;
}
