import fs from 'node:fs';

// packages/workflow-engine/src/AdvancedWorkflowEngine.ts

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import * as ts from 'typescript';
import * as path from 'path';
import { existsSync } from 'fs';

/**
 * Advanced Workflow Engine for AI Agent Orchestration
 * Implements DAG-based pipelines with self-correction loops
 * @version 2.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export enum NodeType {
  AGENT = 'AGENT',
  VALIDATOR = 'VALIDATOR',
  TRANSFORMER = 'TRANSFORMER',
  DECISION = 'DECISION',
  PARALLEL = 'PARALLEL',
  LOOP = 'LOOP',
}

export enum NodeStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  RETRYING = 'RETRYING',
}

export enum WorkflowStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum AgentType {
  ARCHITECT = 'ARCHITECT',
  CODER = 'CODER',
  REVIEWER = 'REVIEWER',
  AUDITOR = 'AUDITOR',
  BUG_HUNTER = 'BUG_HUNTER',
  TESTER = 'TESTER',
}

export interface ASTValidationResult {
  isValid: boolean;
  errors: ts.Diagnostic[];
  warnings: ts.Diagnostic[];
  syntaxTree: ts.SourceFile | null;
  semanticIssues: SemanticIssue[];
}

export interface SemanticIssue {
  type: 'type-error' | 'unused-variable' | 'missing-import' | 'circular-dependency';
  message: string;
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: string;
}

export interface CompilerError {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number;
  category: ts.DiagnosticCategory;
  source: string;
  relatedInformation?: ts.DiagnosticRelatedInformation[];
}

export interface TestResult {
  passed: boolean;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
}

export interface TestFailure {
  testName: string;
  file: string;
  line: number;
  error: string;
  stackTrace: string;
  expectedValue?: unknown;
  actualValue?: unknown;
}

export interface PatchRequest {
  targetFile: string;
  targetLine: number;
  issue: string;
  suggestedFix: string;
  context: {
    surroundingCode: string;
    errorMessage: string;
    variables: Record<string, string>;
  };
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface AgentOutput {
  agentId: string;
  agentType: AgentType;
  success: boolean;
  data: unknown;
  metadata: {
    executionTime: number;
    tokensUsed?: number;
    confidence: number;
    timestamp: number;
  };
  artifacts: Artifact[];
  errors?: Error[];
}

export interface Artifact {
  id: string;
  type: 'code' | 'documentation' | 'test' | 'config' | 'diagram';
  name: string;
  content: string;
  language?: string;
  metadata: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  agentType?: AgentType;
  config: Record<string, unknown>;
  inputs: string[]; // IDs of dependent nodes
  outputs: string[]; // IDs of downstream nodes
  status: NodeStatus;
  retryCount: number;
  maxRetries: number;
  timeout: number; // milliseconds
  output?: AgentOutput;
  error?: Error;
  startTime?: number;
  endTime?: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: (output: AgentOutput) => boolean;
  transform?: (output: AgentOutput) => unknown;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  config: WorkflowConfig;
}

export interface WorkflowConfig {
  maxConcurrency: number;
  enableSelfCorrection: boolean;
  maxCorrectionAttempts: number;
  sandboxConfig: SandboxConfig;
  astValidation: boolean;
  testValidation: boolean;
  persistState: boolean;
}

export interface SandboxConfig {
  maxMemoryMB: number;
  maxCPUPercent: number;
  timeout: number;
  allowedCommands: string[];
  workingDirectory: string;
  environmentVariables: Record<string, string>;
}

export interface ExecutionContext {
  workflowId: string;
  nodeId: string;
  data: Map<string, unknown>;
  artifacts: Map<string, Artifact>;
  correctionHistory: CorrectionRecord[];
}

export interface CorrectionRecord {
  timestamp: number;
  originalError: CompilerError | TestFailure;
  patchRequest: PatchRequest;
  agentResponse: AgentOutput;
  resolved: boolean;
}

export interface WorkflowMetrics {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  totalExecutionTime: number;
  averageNodeExecutionTime: number;
  correctionsApplied: number;
  successRate: number;
}

// ============================================================================
// Custom Errors
// ============================================================================

export class WorkflowError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export class DAGValidationError extends WorkflowError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DAG_VALIDATION_ERROR', context);
    this.name = 'DAGValidationError';
  }
}

export class NodeExecutionError extends WorkflowError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NODE_EXECUTION_ERROR', context);
    this.name = 'NodeExecutionError';
  }
}

export class SandboxExecutionError extends WorkflowError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SANDBOX_EXECUTION_ERROR', context);
    this.name = 'SandboxExecutionError';
  }
}

// ============================================================================
// Logger
// ============================================================================

class WorkflowLogger {
  private context: string;
  private level: 'debug' | 'info' | 'warn' | 'error';

  constructor(context: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.context = context;
    this.level = level;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private format(level: string, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) console.debug(this.format('debug', message, meta));
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) console.info(this.format('info', message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) console.error(this.format('error', message, meta));
  }
}

// ============================================================================
// TypeScript AST Indexer & Validator
// ============================================================================

export class TypeScriptASTValidator {
  private logger: WorkflowLogger;
  private compilerOptions: ts.CompilerOptions;

  constructor() {
    this.logger = new WorkflowLogger('TypeScriptASTValidator');
    this.compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
    };
  }

  public async validateCode(
    code: string,
    fileName: string = 'temp.ts'
  ): Promise<ASTValidationResult> {
    try {
      this.logger.debug('Validating TypeScript code', { fileName });

      const sourceFile = ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS
      );

      // Syntactic validation
      const syntacticDiagnostics = this.getSyntacticDiagnostics(sourceFile);

      // Semantic validation
      const program = this.createProgram([{ fileName, content: code }]);
      const semanticDiagnostics = this.getSemanticDiagnostics(program, fileName);
      const semanticIssues = this.extractSemanticIssues(semanticDiagnostics);

      const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];
      const errors = allDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
      const warnings = allDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Warning);

      const result: ASTValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        syntaxTree: sourceFile,
        semanticIssues,
      };

      this.logger.info('Code validation completed', {
        isValid: result.isValid,
        errorCount: errors.length,
        warningCount: warnings.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Code validation failed', { error });
      return {
        isValid: false,
        errors: [],
        warnings: [],
        syntaxTree: null,
        semanticIssues: [],
      };
    }
  }

  private getSyntacticDiagnostics(sourceFile: ts.SourceFile): ts.Diagnostic[] {
    const diagnostics: ts.Diagnostic[] = [];
    
    function visit(node: ts.Node) {
      // Check for syntax errors
      const nodeDiagnostics = (node as any).parseDiagnostics;
      if (nodeDiagnostics) {
        diagnostics.push(...nodeDiagnostics);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return diagnostics;
  }

  private createProgram(files: Array<{ fileName: string; content: string }>): ts.Program {
    const fileMap = new Map(files.map(f => [f.fileName, f.content]));

    const host: ts.CompilerHost = {
      getSourceFile: (fileName: string) => {
        const content = fileMap.get(fileName);
        if (content !== undefined) {
          return ts.createSourceFile(fileName, content, ts.ScriptTarget.ES2022, true);
        }
        // Try to read from file system
        if (existsSync(fileName)) {
          const fileContent = fs.readFileSync(fileName, 'utf-8');
          return ts.createSourceFile(fileName, fileContent, ts.ScriptTarget.ES2022, true);
        }
        return undefined;
      },
      getDefaultLibFileName: () => ts.getDefaultLibFilePath(this.compilerOptions),
      writeFile: () => {},
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (fileName: string) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (fileName: string) => fileMap.has(fileName) || existsSync(fileName),
      readFile: (fileName: string) => fileMap.get(fileName) || '',
    };

    return ts.createProgram(
      Array.from(fileMap.keys()),
      this.compilerOptions,
      host
    );
  }

  private getSemanticDiagnostics(program: ts.Program, fileName: string): ts.Diagnostic[] {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return [];

    const diagnostics = [
      ...program.getSemanticDiagnostics(sourceFile),
      ...program.getDeclarationDiagnostics(sourceFile),
    ];

    return diagnostics;
  }

  private extractSemanticIssues(diagnostics: ts.Diagnostic[]): SemanticIssue[] {
    return diagnostics.map(diagnostic => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const file = diagnostic.file?.fileName || 'unknown';
      const position = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : { line: 0, character: 0 };

      let type: SemanticIssue['type'] = 'type-error';
      if (message.includes('unused')) type = 'unused-variable';
      if (message.includes('import')) type = 'missing-import';
      if (message.includes('circular')) type = 'circular-dependency';

      return {
        type,
        message,
        file,
        line: position.line + 1,
        column: position.character + 1,
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        suggestedFix: this.generateSuggestedFix(diagnostic),
      };
    });
  }

  private generateSuggestedFix(diagnostic: ts.Diagnostic): string | undefined {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    
    // Simple heuristic-based suggestions
    if (message.includes("Cannot find name")) {
      const match = message.match(/Cannot find name '(.+)'/);
      if (match) {
        return `Consider importing or declaring '${match[1]}'`;
      }
    }
    
    if (message.includes("not assignable to type")) {
      return "Check type compatibility or use type assertion";
    }

    return undefined;
  }

  public extractCompilerErrors(diagnostics: ts.Diagnostic[]): CompilerError[] {
    return diagnostics
      .filter(d => d.category === ts.DiagnosticCategory.Error)
      .map(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        const file = diagnostic.file?.fileName || 'unknown';
        const position = diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : { line: 0, character: 0 };

        const source = diagnostic.file && diagnostic.start !== undefined && diagnostic.length
          ? diagnostic.file.text.substring(diagnostic.start, diagnostic.start + diagnostic.length)
          : '';

        return {
          file,
          line: position.line + 1,
          column: position.character + 1,
          message,
          code: typeof diagnostic.code === 'number' ? diagnostic.code : 0,
          category: diagnostic.category,
          source,
          relatedInformation: diagnostic.relatedInformation,
        };
      });
  }
}

// ============================================================================
// Sandboxed Executor
// ============================================================================

export class SandboxExecutor {
  private logger: WorkflowLogger;
  private config: SandboxConfig;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.logger = new WorkflowLogger('SandboxExecutor');
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 512,
      maxCPUPercent: config.maxCPUPercent ?? 80,
      timeout: config.timeout ?? 30000,
      allowedCommands: config.allowedCommands ?? ['node', 'npm', 'tsc', 'jest'],
      workingDirectory: config.workingDirectory ?? process.cwd(),
      environmentVariables: config.environmentVariables ?? {},
    };
  }

  public async execute(
    command: string,
    args: string[],
    options: { stdin?: string } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      // Validate command
      if (!this.isCommandAllowed(command)) {
        reject(new SandboxExecutionError(`Command not allowed: ${command}`, { command }));
        return;
      }

      this.logger.info('Executing sandboxed command', { command, args });

      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;
      let memoryViolation = false;

      const child: ChildProcess = spawn(command, args, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environmentVariables,
          NODE_OPTIONS: `--max-old-space-size=${this.config.maxMemoryMB}`,
        },
        timeout: this.config.timeout,
        shell: false,
      });

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000);
      }, this.config.timeout);

      // Monitor memory usage
      const memoryCheckInterval = setInterval(() => {
        if (child.pid) {
          this.checkMemoryUsage(child.pid).then(memoryMB => {
            if (memoryMB > this.config.maxMemoryMB) {
              memoryViolation = true;
              this.logger.warn('Memory limit exceeded', { memoryMB, limit: this.config.maxMemoryMB });
              child.kill('SIGTERM');
              clearInterval(memoryCheckInterval);
            }
          }).catch(() => {
            // Ignore memory check errors
          });
        }
      }, 500);

      // Collect stdout
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      // Collect stderr
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      // Send stdin if provided
      if (options.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }

      // Handle completion
      child.on('close', (code: number | null) => {
        clearTimeout(timeoutHandle);
        clearInterval(memoryCheckInterval);

        const duration = Date.now() - startTime;

        if (isTimedOut) {
          reject(new SandboxExecutionError(
            `Command timed out after ${this.config.timeout}ms`,
            { command, args, timeout: this.config.timeout }
          ));
          return;
        }

        if (memoryViolation) {
          reject(new SandboxExecutionError(
            `Memory limit exceeded: ${this.config.maxMemoryMB}MB`,
            { command, args, limit: this.config.maxMemoryMB }
          ));
          return;
        }

        this.logger.info('Command execution completed', {
          command,
          exitCode: code ?? -1,
          duration,
        });

        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1,
        });
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeoutHandle);
        clearInterval(memoryCheckInterval);
        reject(new SandboxExecutionError(`Execution failed: ${error.message}`, {
          command,
          args,
          error: error.message,
        }));
      });
    });
  }

  private isCommandAllowed(command: string): boolean {
    const baseCommand = path.basename(command);
    return this.config.allowedCommands.some(allowed => 
      baseCommand === allowed || baseCommand.startsWith(allowed)
    );
  }

  private async checkMemoryUsage(pid: number): Promise<number> {
    try {
      const result = await this.execute('ps', ['-o', 'rss=', '-p', pid.toString()]);
      const memoryKB = parseInt(result.stdout.trim(), 10);
      return memoryKB / 1024; // Convert to MB
    } catch {
      return 0;
    }
  }

  public async compileTypeScript(files: string[]): Promise<CompilerError[]> {
    try {
      const args = ['--noEmit', '--pretty', 'false', ...files];
      const result = await this.execute('tsc', args);

      if (result.exitCode === 0) {
        return [];
      }

      return this.parseCompilerOutput(result.stdout + result.stderr);
    } catch (error) {
      this.logger.error('TypeScript compilation failed', { error });
      throw error;
    }
  }

  private parseCompilerOutput(output: string): CompilerError[] {
    const errors: CompilerError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Parse TypeScript error format: file.ts(line,col): error TS####: message
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/);
      if (match) {
        errors.push({
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[6],
          code: parseInt(match[5], 10),
          category: match[4] === 'error' 
            ? ts.DiagnosticCategory.Error 
            : ts.DiagnosticCategory.Warning,
          source: '',
        });
      }
    }

    return errors;
  }

  public async runTests(testCommand: string[]): Promise<TestResult> {
    try {
      const [command, ...args] = testCommand;
      const result = await this.execute(command, args);

      return this.parseTestOutput(result.stdout, result.stderr, result.exitCode);
    } catch (error) {
      this.logger.error('Test execution failed', { error });
      throw error;
    }
  }

  private parseTestOutput(stdout: string, stderr: string, exitCode: number): TestResult {
    // Parse Jest-style output
    const output = stdout + stderr;
    
    const passMatch = output.match(/Tests:\s+(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);
    const totalMatch = output.match(/(\d+)\s+total/);
    const durationMatch = output.match(/Time:\s+([\d.]+)\s*s/);

    const passed = exitCode === 0;
    const succeeded = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const total = totalMatch ? parseInt(totalMatch[1], 10) : succeeded + failed;
    const duration = durationMatch ? parseFloat(durationMatch[1]) * 1000 : 0;

    const failures = this.parseTestFailures(output);

    return {
      passed,
      total,
      succeeded,
      failed,
      skipped: total - succeeded - failed,
      duration,
      failures,
    };
  }

  private parseTestFailures(output: string): TestFailure[] {
    const failures: TestFailure[] = [];
    const failureBlocks = output.split('●').slice(1);

    for (const block of failureBlocks) {
      const lines = block.trim().split('\n');
      const testName = lines[0]?.trim() || 'Unknown test';
      
      const fileMatch = block.match(/at\s+.+\s+\((.+?):(\d+):/);
      const file = fileMatch ? fileMatch[1] : 'unknown';
      const line = fileMatch ? parseInt(fileMatch[2], 10) : 0;

      const errorMatch = block.match(/Error:\s+(.+?)(?:\n|$)/);
      const error = errorMatch ? errorMatch[1] : 'Unknown error';

      failures.push({
        testName,
        file,
        line,
        error,
        stackTrace: block,
      });
    }

    return failures;
  }
}

// ============================================================================
// Self-Correction Engine
// ============================================================================

export class SelfCorrectionEngine {
  private logger: WorkflowLogger;
  private astValidator: TypeScriptASTValidator;
  private sandbox: SandboxExecutor;

  constructor(sandbox: SandboxExecutor) {
    this.logger = new WorkflowLogger('SelfCorrectionEngine');
    this.astValidator = new TypeScriptASTValidator();
    this.sandbox = sandbox;
  }

  public async analyzeAndCorrect(
    code: string,
    fileName: string,
    context: ExecutionContext
  ): Promise<{ corrected: boolean; code: string; patches: PatchRequest[] }> {
    this.logger.info('Starting self-correction analysis', { fileName });

    // Step 1: AST Validation
    const astResult = await this.astValidator.validateCode(code, fileName);
    
    if (astResult.isValid) {
      this.logger.info('Code passed AST validation');
      return { corrected: false, code, patches: [] };
    }

    // Step 2: Extract errors and generate patch requests
    const compilerErrors = this.astValidator.extractCompilerErrors(astResult.errors);
    const patches = await this.generatePatchRequests(compilerErrors, code, fileName);

    this.logger.info('Generated patch requests', { count: patches.length });

    return { corrected: true, code, patches };
  }

  private async generatePatchRequests(
    errors: CompilerError[],
    code: string,
    fileName: string
  ): Promise<PatchRequest[]> {
    const patches: PatchRequest[] = [];
    const lines = code.split('\n');

    for (const error of errors) {
      const context = this.extractContext(lines, error.line, 3);
      const suggestedFix = this.generateFix(error, context);

      patches.push({
        targetFile: fileName,
        targetLine: error.line,
        issue: error.message,
        suggestedFix,
        context: {
          surroundingCode: context,
          errorMessage: error.message,
          variables: this.extractVariables(context),
        },
        priority: this.determinePriority(error),
      });
    }

    return patches;
  }

  private extractContext(lines: string[], lineNumber: number, contextLines: number): string {
    const start = Math.max(0, lineNumber - contextLines - 1);
    const end = Math.min(lines.length, lineNumber + contextLines);
    
    return lines
      .slice(start, end)
      .map((line, idx) => {
        const currentLine = start + idx + 1;
        const marker = currentLine === lineNumber ? '>>> ' : '    ';
        return `${marker}${currentLine}: ${line}`;
      })
      .join('\n');
  }

  private extractVariables(context: string): Record<string, string> {
    const variables: Record<string, string> = {};
    const varPattern = /\b(?:const|let|var)\s+(\w+)\s*[:=]/g;
    
    let match;
    while ((match = varPattern.exec(context)) !== null) {
      variables[match[1]] = 'unknown';
    }

    return variables;
  }

  private generateFix(error: CompilerError, context: string): string {
    const message = error.message.toLowerCase();

    // Type error fixes
    if (message.includes('type') && message.includes('not assignable')) {
      return 'Add type assertion or fix type mismatch';
    }

    // Missing import fixes
    if (message.includes('cannot find name')) {
      const match = error.message.match(/Cannot find name '(.+?)'/);
      if (match) {
        return `Add import statement for '${match[1]}'`;
      }
    }

    // Missing property fixes
    if (message.includes('property') && message.includes('does not exist')) {
      const match = error.message.match(/Property '(.+?)' does not exist/);
      if (match) {
        return `Add property '${match[1]}' to the type definition`;
      }
    }

    // Syntax error fixes
    if (message.includes('expected')) {
      return 'Fix syntax error by adding missing tokens';
    }

    return 'Review and fix the error manually';
  }

  private determinePriority(error: CompilerError): PatchRequest['priority'] {
    const message = error.message.toLowerCase();

    if (message.includes('syntax') || message.includes('unexpected')) {
      return 'critical';
    }

    if (message.includes('type') && message.includes('assignable')) {
      return 'high';
    }

    if (message.includes('unused')) {
      return 'low';
    }

    return 'medium';
  }

  public async applyPatches(
    originalCode: string,
    patches: PatchRequest[],
    agentResponse: AgentOutput
  ): Promise<string> {
    let correctedCode = originalCode;

    // Sort patches by line number (descending) to avoid offset issues
    const sortedPatches = [...patches].sort((a, b) => b.targetLine - a.targetLine);

    for (const patch of sortedPatches) {
      if (agentResponse.artifacts.length > 0) {
        // Agent provided corrected code
        const correctionArtifact = agentResponse.artifacts.find(
          a => a.type === 'code' && a.metadata.patchLine === patch.targetLine
        );

        if (correctionArtifact) {
          correctedCode = correctionArtifact.content;
        }
      }
    }

    return correctedCode;
  }
}

// ============================================================================
// DAG Workflow Engine
// ============================================================================

export class AdvancedWorkflowEngine extends EventEmitter {
  private logger: WorkflowLogger;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executionContexts: Map<string, ExecutionContext> = new Map();
  private astValidator: TypeScriptASTValidator;
  private sandbox: SandboxExecutor;
  private correctionEngine: SelfCorrectionEngine;
  private runningWorkflows: Map<string, WorkflowStatus> = new Map();

  constructor(sandboxConfig?: Partial<SandboxConfig>) {
    super();
    this.logger = new WorkflowLogger('AdvancedWorkflowEngine');
    this.astValidator = new TypeScriptASTValidator();
    this.sandbox = new SandboxExecutor(sandboxConfig);
    this.correctionEngine = new SelfCorrectionEngine(this.sandbox);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('workflow:started', (workflowId: string) => {
      this.logger.info('Workflow started', { workflowId });
    });

    this.on('workflow:completed', (workflowId: string) => {
      this.logger.info('Workflow completed', { workflowId });
    });

    this.on('node:completed', (workflowId: string, nodeId: string) => {
      this.logger.debug('Node completed', { workflowId, nodeId });
    });

    this.on('correction:applied', (workflowId: string, correction: CorrectionRecord) => {
      this.logger.info('Correction applied', {
        workflowId,
        resolved: correction.resolved,
      });
    });
  }

  // ============================================================================
  // Workflow Definition & Validation
  // ============================================================================

  public createWorkflow(
    name: string,
    description: string,
    config: Partial<WorkflowConfig> = {}
  ): WorkflowDefinition {
    const workflow: WorkflowDefinition = {
      id: randomUUID(),
      name,
      description,
      nodes: [],
      edges: [],
      config: {
        maxConcurrency: config.maxConcurrency ?? 3,
        enableSelfCorrection: config.enableSelfCorrection ?? true,
        maxCorrectionAttempts: config.maxCorrectionAttempts ?? 3,
        sandboxConfig: config.sandboxConfig ?? this.sandbox['config'],
        astValidation: config.astValidation ?? true,
        testValidation: config.testValidation ?? true,
        persistState: config.persistState ?? true,
      },
    };

    this.workflows.set(workflow.id, workflow);
    this.logger.info('Workflow created', { workflowId: workflow.id, name });

    return workflow;
  }

  public addNode(
    workflowId: string,
    type: NodeType,
    name: string,
    config: Record<string, unknown>,
    agentType?: AgentType
  ): WorkflowNode {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workflowId });
    }

    const node: WorkflowNode = {
      id: randomUUID(),
      type,
      name,
      agentType,
      config,
      inputs: [],
      outputs: [],
      status: NodeStatus.PENDING,
      retryCount: 0,
      maxRetries: (config.maxRetries as number) ?? 3,
      timeout: (config.timeout as number) ?? 60000,
    };

    workflow.nodes.push(node);
    this.logger.debug('Node added to workflow', { workflowId, nodeId: node.id, name });

    return node;
  }

  public addEdge(
    workflowId: string,
    fromNodeId: string,
    toNodeId: string,
    condition?: (output: AgentOutput) => boolean,
    transform?: (output: AgentOutput) => unknown
  ): WorkflowEdge {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workflowId });
    }

    const fromNode = workflow.nodes.find(n => n.id === fromNodeId);
    const toNode = workflow.nodes.find(n => n.id === toNodeId);

    if (!fromNode || !toNode) {
      throw new DAGValidationError('Node not found in workflow', {
        workflowId,
        fromNodeId,
        toNodeId,
      });
    }

    const edge: WorkflowEdge = { from: fromNodeId, to: toNodeId, condition, transform };

    workflow.edges.push(edge);
    fromNode.outputs.push(toNodeId);
    toNode.inputs.push(fromNodeId);

    this.logger.debug('Edge added to workflow', { workflowId, from: fromNodeId, to: toNodeId });

    return edge;
  }

  public validateDAG(workflowId: string): { isValid: boolean; errors: string[] } {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workflowId });
    }

    const errors: string[] = [];

    // Check for cycles
    if (this.hasCycle(workflow)) {
      errors.push('Workflow contains cycles (not a valid DAG)');
    }

    // Check for disconnected nodes
    const disconnectedNodes = this.findDisconnectedNodes(workflow);
    if (disconnectedNodes.length > 0) {
      errors.push(`Disconnected nodes found: ${disconnectedNodes.join(', ')}`);
    }

    // Check for missing dependencies
    for (const node of workflow.nodes) {
      for (const inputId of node.inputs) {
        if (!workflow.nodes.find(n => n.id === inputId)) {
          errors.push(`Node ${node.id} references non-existent input ${inputId}`);
        }
      }
    }

    const isValid = errors.length === 0;

    this.logger.info('DAG validation completed', { workflowId, isValid, errorCount: errors.length });

    return { isValid, errors };
  }

  private hasCycle(workflow: WorkflowDefinition): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = workflow.nodes.find(n => n.id === nodeId);
      if (!node) return false;

      for (const outputId of node.outputs) {
        if (!visited.has(outputId)) {
          if (dfs(outputId)) return true;
        } else if (recursionStack.has(outputId)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const node of workflow.nodes) {
      if (!visited.has(node.id)) {
        if (dfs(node.id)) return true;
      }
    }

    return false;
  }

  private findDisconnectedNodes(workflow: WorkflowDefinition): string[] {
    const connected = new Set<string>();
    const startNodes = workflow.nodes.filter(n => n.inputs.length === 0);

    const dfs = (nodeId: string) => {
      connected.add(nodeId);
      const node = workflow.nodes.find(n => n.id === nodeId);
      if (node) {
        for (const outputId of node.outputs) {
          if (!connected.has(outputId)) {
            dfs(outputId);
          }
        }
      }
    };

    for (const startNode of startNodes) {
      dfs(startNode.id);
    }

    return workflow.nodes
      .filter(n => !connected.has(n.id))
      .map(n => n.id);
  }

  private topologicalSort(workflow: WorkflowDefinition): WorkflowNode[] {
    const inDegree = new Map<string, number>();
    const queue: WorkflowNode[] = [];
    const result: WorkflowNode[] = [];

    // Initialize in-degrees
    for (const node of workflow.nodes) {
      inDegree.set(node.id, node.inputs.length);
      if (node.inputs.length === 0) {
        queue.push(node);
      }
    }

    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);

      for (const outputId of node.outputs) {
        const currentDegree = inDegree.get(outputId) ?? 0;
        inDegree.set(outputId, currentDegree - 1);

        if (currentDegree - 1 === 0) {
          const outputNode = workflow.nodes.find(n => n.id === outputId);
          if (outputNode) {
            queue.push(outputNode);
          }
        }
      }
    }

    return result;
  }

  // ============================================================================
  // Workflow Execution
  // ============================================================================

  public async executeWorkflow(workflowId: string): Promise<WorkflowMetrics> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workflowId });
    }

    // Validate DAG
    const validation = this.validateDAG(workflowId);
    if (!validation.isValid) {
      throw new DAGValidationError('Invalid DAG structure', {
        workflowId,
        errors: validation.errors,
      });
    }

    this.logger.info('Starting workflow execution', { workflowId, name: workflow.name });

    const context: ExecutionContext = {
      workflowId,
      nodeId: '',
      data: new Map(),
      artifacts: new Map(),
      correctionHistory: [],
    };

    this.executionContexts.set(workflowId, context);
    this.runningWorkflows.set(workflowId, WorkflowStatus.RUNNING);
    this.emit('workflow:started', workflowId);

    const startTime = Date.now();

    try {
      // Execute nodes in topological order
      const sortedNodes = this.topologicalSort(workflow);
      await this.executeNodesInOrder(workflow, sortedNodes, context);

      const totalTime = Date.now() - startTime;
      this.runningWorkflows.set(workflowId, WorkflowStatus.COMPLETED);
      this.emit('workflow:completed', workflowId);

      return this.calculateMetrics(workflow, totalTime);
    } catch (error) {
      this.logger.error('Workflow execution failed', { workflowId, error });
      this.runningWorkflows.set(workflowId, WorkflowStatus.FAILED);
      this.emit('workflow:failed', workflowId, error);
      throw error;
    }
  }

  private async executeNodesInOrder(
    workflow: WorkflowDefinition,
    sortedNodes: WorkflowNode[],
    context: ExecutionContext
  ): Promise<void> {
    const executing = new Set<string>();
    const completed = new Set<string>();

    for (const node of sortedNodes) {
      // Wait for all dependencies to complete
      await this.waitForDependencies(node, completed);

      // Check concurrency limit
      while (executing.size >= workflow.config.maxConcurrency) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      executing.add(node.id);

      // Execute node
      this.executeNode(workflow, node, context)
        .then(() => {
          executing.delete(node.id);
          completed.add(node.id);
          this.emit('node:completed', workflow.id, node.id);
        })
        .catch(error => {
          executing.delete(node.id);
          this.logger.error('Node execution failed', {
            workflowId: workflow.id,
            nodeId: node.id,
            error,
          });
        });
    }

    // Wait for all nodes to complete
    while (completed.size < sortedNodes.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async waitForDependencies(
    node: WorkflowNode,
    completed: Set<string>
  ): Promise<void> {
    while (!node.inputs.every(inputId => completed.has(inputId))) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async executeNode(
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    context: ExecutionContext
  ): Promise<void> {
    this.logger.info('Executing node', { workflowId: workflow.id, nodeId: node.id, name: node.name });

    node.status = NodeStatus.RUNNING;
    node.startTime = Date.now();
    context.nodeId = node.id;

    try {
      // Collect inputs from dependencies
      const inputs = this.collectNodeInputs(workflow, node, context);

      // Execute based on node type
      let output: AgentOutput;

      switch (node.type) {
        case NodeType.AGENT:
          output = await this.executeAgentNode(node, inputs, context, workflow);
          break;
        case NodeType.VALIDATOR:
          output = await this.executeValidatorNode(node, inputs, context);
          break;
        case NodeType.TRANSFORMER:
          output = await this.executeTransformerNode(node, inputs, context);
          break;
        case NodeType.DECISION:
          output = await this.executeDecisionNode(node, inputs, context);
          break;
        default:
          output = await this.executeAgentNode(node, inputs, context, workflow);
      }

      node.output = output;
      node.status = NodeStatus.COMPLETED;
      node.endTime = Date.now();

      // Store output in context
      context.data.set(node.id, output.data);
      output.artifacts.forEach(artifact => {
        context.artifacts.set(artifact.id, artifact);
      });

    } catch (error) {
      const err = error as Error;
      node.error = err;
      node.status = NodeStatus.FAILED;
      node.endTime = Date.now();

      // Retry logic
      if (node.retryCount < node.maxRetries) {
        node.retryCount++;
        node.status = NodeStatus.RETRYING;
        this.logger.warn('Retrying node execution', {
          nodeId: node.id,
          attempt: node.retryCount,
          maxRetries: node.maxRetries,
        });
        await new Promise(resolve => setTimeout(resolve, 1000 * node.retryCount));
        return this.executeNode(workflow, node, context);
      }

      throw new NodeExecutionError(`Node execution failed: ${err.message}`, {
        workflowId: workflow.id,
        nodeId: node.id,
        error: err.message,
      });
    }
  }

  private collectNodeInputs(
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    context: ExecutionContext
  ): Map<string, unknown> {
    const inputs = new Map<string, unknown>();

    for (const inputId of node.inputs) {
      const edge = workflow.edges.find(e => e.from === inputId && e.to === node.id);
      const inputData = context.data.get(inputId);

      if (inputData !== undefined) {
        const transformedData = edge?.transform
          ? edge.transform(inputData as AgentOutput)
          : inputData;
        inputs.set(inputId, transformedData);
      }
    }

    return inputs;
  }

  private async executeAgentNode(
    node: WorkflowNode,
    inputs: Map<string, unknown>,
    context: ExecutionContext,
    workflow: WorkflowDefinition
  ): Promise<AgentOutput> {
    const startTime = Date.now();

    // Simulate agent execution (in production, call actual agent)
    const agentOutput = await this.simulateAgentExecution(node, inputs);

    // Validate code artifacts if enabled
    if (workflow.config.astValidation && node.agentType === AgentType.CODER) {
      await this.validateAndCorrectCode(agentOutput, context, workflow);
    }

    // Run tests if enabled
    if (workflow.config.testValidation && node.config.testCommand) {
      await this.runTestsAndCorrect(agentOutput, context, workflow);
    }

    agentOutput.metadata.executionTime = Date.now() - startTime;

    return agentOutput;
  }

  private async simulateAgentExecution(
    node: WorkflowNode,
    inputs: Map<string, unknown>
  ): Promise<AgentOutput> {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    const artifacts: Artifact[] = [];

    // Generate code artifact for CODER agents
    if (node.agentType === AgentType.CODER) {
      artifacts.push({
        id: randomUUID(),
        type: 'code',
        name: 'generated-code.ts',
        content: this.generateSampleCode(node.config),
        language: 'typescript',
        metadata: { nodeId: node.id },
      });
    }

    return {
      agentId: node.id,
      agentType: node.agentType ?? AgentType.CODER,
      success: true,
      data: { result: 'Task completed', inputs: Array.from(inputs.entries()) },
      metadata: {
        executionTime: 1000,
        confidence: 0.95,
        timestamp: Date.now(),
      },
      artifacts,
    };
  }

  private generateSampleCode(config: Record<string, unknown>): string {
    // Generate intentionally flawed code for demonstration
    return `
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUser(id: string): User | undefined {
    return this.users.find(u => u.id = id); // Intentional error: should be ===
  }

  getAllUsers(): User[] {
    return this.users;
  }
}
`.trim();
  }

  private async validateAndCorrectCode(
    agentOutput: AgentOutput,
    context: ExecutionContext,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const codeArtifacts = agentOutput.artifacts.filter(a => a.type === 'code');

    for (const artifact of codeArtifacts) {
      const result = await this.correctionEngine.analyzeAndCorrect(
        artifact.content,
        artifact.name,
        context
      );

      if (result.corrected && workflow.config.enableSelfCorrection) {
        this.logger.warn('Code validation failed, applying corrections', {
          file: artifact.name,
          patchCount: result.patches.length,
        });

        // Request corrections from Reviewer agent
        const correctedOutput = await this.requestCodeCorrection(
          result.patches,
          agentOutput,
          context
        );

        if (correctedOutput) {
          // Apply patches
          const correctedCode = await this.correctionEngine.applyPatches(
            artifact.content,
            result.patches,
            correctedOutput
          );

          artifact.content = correctedCode;

          // Record correction
          const correctionRecord: CorrectionRecord = {
            timestamp: Date.now(),
            originalError: result.patches[0] as any,
            patchRequest: result.patches[0],
            agentResponse: correctedOutput,
            resolved: true,
          };

          context.correctionHistory.push(correctionRecord);
          this.emit('correction:applied', context.workflowId, correctionRecord);
        }
      }
    }
  }

  private async requestCodeCorrection(
    patches: PatchRequest[],
    originalOutput: AgentOutput,
    context: ExecutionContext
  ): Promise<AgentOutput | null> {
    this.logger.info('Requesting code correction from Reviewer agent', {
      patchCount: patches.length,
    });

    // Simulate Reviewer agent analysis and correction
    await new Promise(resolve => setTimeout(resolve, 1500));

    const correctedArtifacts: Artifact[] = patches.map(patch => ({
      id: randomUUID(),
      type: 'code',
      name: patch.targetFile,
      content: this.applySuggestedFix(originalOutput.artifacts[0]?.content || '', patch),
      language: 'typescript',
      metadata: {
        patchLine: patch.targetLine,
        correctionApplied: true,
      },
    }));

    return {
      agentId: 'reviewer-agent',
      agentType: AgentType.REVIEWER,
      success: true,
      data: { corrections: patches.length },
      metadata: {
        executionTime: 1500,
        confidence: 0.88,
        timestamp: Date.now(),
      },
      artifacts: correctedArtifacts,
    };
  }

  private applySuggestedFix(code: string, patch: PatchRequest): string {
    const lines = code.split('\n');
    
    // Simple fix application (in production, use more sophisticated AST transformation)
    if (patch.issue.includes('should be ===')) {
      lines[patch.targetLine - 1] = lines[patch.targetLine - 1].replace(' = ', ' === ');
    }

    return lines.join('\n');
  }

  private async runTestsAndCorrect(
    agentOutput: AgentOutput,
    context: ExecutionContext,
    workflow: WorkflowDefinition
  ): Promise<void> {
    // This would run actual tests in production
    this.logger.info('Running test validation');
  }

  private async executeValidatorNode(
    node: WorkflowNode,
    inputs: Map<string, unknown>,
    context: ExecutionContext
  ): Promise<AgentOutput> {
    // Validation logic
    const validationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    return {
      agentId: node.id,
      agentType: AgentType.REVIEWER,
      success: validationResult.isValid,
      data: validationResult,
      metadata: {
        executionTime: 500,
        confidence: 1.0,
        timestamp: Date.now(),
      },
      artifacts: [],
    };
  }

  private async executeTransformerNode(
    node: WorkflowNode,
    inputs: Map<string, unknown>,
    context: ExecutionContext
  ): Promise<AgentOutput> {
    const transformFn = node.config.transform as ((data: unknown) => unknown) | undefined;
    const inputData = Array.from(inputs.values())[0];

    const transformed = transformFn ? transformFn(inputData) : inputData;

    return {
      agentId: node.id,
      agentType: AgentType.ARCHITECT,
      success: true,
      data: transformed,
      metadata: {
        executionTime: 100,
        confidence: 1.0,
        timestamp: Date.now(),
      },
      artifacts: [],
    };
  }

  private async executeDecisionNode(
    node: WorkflowNode,
    inputs: Map<string, unknown>,
    context: ExecutionContext
  ): Promise<AgentOutput> {
    const conditionFn = node.config.condition as ((data: unknown) => boolean) | undefined;
    const inputData = Array.from(inputs.values())[0];

    const decision = conditionFn ? conditionFn(inputData) : true;

    return {
      agentId: node.id,
      agentType: AgentType.ARCHITECT,
      success: true,
      data: { decision },
      metadata: {
        executionTime: 50,
        confidence: 1.0,
        timestamp: Date.now(),
      },
      artifacts: [],
    };
  }

  private calculateMetrics(workflow: WorkflowDefinition, totalTime: number): WorkflowMetrics {
    const completedNodes = workflow.nodes.filter(n => n.status === NodeStatus.COMPLETED);
    const failedNodes = workflow.nodes.filter(n => n.status === NodeStatus.FAILED);

    const avgTime = completedNodes.length > 0
      ? completedNodes.reduce((sum, n) => sum + ((n.endTime ?? 0) - (n.startTime ?? 0)), 0) / completedNodes.length
      : 0;

    const context = this.executionContexts.get(workflow.id);

    return {
      totalNodes: workflow.nodes.length,
      completedNodes: completedNodes.length,
      failedNodes: failedNodes.length,
      totalExecutionTime: totalTime,
      averageNodeExecutionTime: avgTime,
      correctionsApplied: context?.correctionHistory.length ?? 0,
      successRate: completedNodes.length / workflow.nodes.length,
    };
  }

  // ============================================================================
  // Query & Monitoring
  // ============================================================================

  public getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  public getWorkflowStatus(workflowId: string): WorkflowStatus | undefined {
    return this.runningWorkflows.get(workflowId);
  }

  public getExecutionContext(workflowId: string): ExecutionContext | undefined {
    return this.executionContexts.get(workflowId);
  }

  public async exportWorkflow(workflowId: string): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workflowId });
    }

    return JSON.stringify(workflow, null, 2);
  }

  public async importWorkflow(workflowJson: string): Promise<WorkflowDefinition> {
    const workflow = JSON.parse(workflowJson) as WorkflowDefinition;
    workflow.id = randomUUID(); // Generate new ID
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }
}

// ============================================================================
// Export
// ============================================================================

export default AdvancedWorkflowEngine;
