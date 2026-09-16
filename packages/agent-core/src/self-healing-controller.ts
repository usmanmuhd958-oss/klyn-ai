import { createHash } from "node:crypto";
import type {
  HermeticToolCall,
  ProcessSandboxResult,
  ToolAuditRecord,
} from "@klyn/execution-runtime";
import type { AgentRole } from "./contracts.js";
import type { AgentToolExecutor } from "./tool-executor.js";

export interface SelfHealingDiagnostic {
  readonly source: "stdout" | "stderr";
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly code: string | null;
  readonly message: string;
}

export interface RepairPlanningInput {
  readonly runId: string;
  readonly attempt: number;
  readonly failure: ProcessSandboxResult;
  readonly diagnostics: readonly SelfHealingDiagnostic[];
  readonly failureEvidenceHash: string;
  readonly previousRepairAuditHash: string | null;
}

export interface SelfHealingPlanner {
  plan(input: RepairPlanningInput): Promise<HermeticToolCall | null>;
}

export interface SelfHealingAttempt {
  readonly attempt: number;
  readonly failureEvidenceHash: string;
  readonly repairAuditSequence: number;
  readonly repairAuditHash: string;
  readonly repairEvidenceHash: string;
  readonly diagnostics: readonly SelfHealingDiagnostic[];
}

export interface SelfHealingResult {
  readonly attempts: readonly SelfHealingAttempt[];
  readonly finalResult: ProcessSandboxResult;
}

export class SelfHealingExhaustedError extends Error {
  readonly attempts: readonly SelfHealingAttempt[];
  readonly finalFailure: ProcessSandboxResult;

  constructor(attempts: readonly SelfHealingAttempt[], finalFailure: ProcessSandboxResult) {
    super(`Self-healing exhausted after ${attempts.length} repair attempt(s)`);
    this.name = "SelfHealingExhaustedError";
    this.attempts = [...attempts];
    this.finalFailure = finalFailure;
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const failureEvidenceHash = (result: ProcessSandboxResult): string =>
  sha256(JSON.stringify({
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    memoryExceeded: result.memoryExceeded,
  }));

const diagnosticPatterns: readonly RegExp[] = [
  /^(.*?)(?:\((\d+),(\d+)\))?:\s*error\s+(TS\d+):\s*(.+)$/,
  /^(.*?):(\d+):(\d+):\s*(?:error|fatal error):\s*(.+)$/,
  /^(.*?):(\d+):\s*error:\s*(.+)$/,
  /SyntaxError: (.+?)\s+at\s+(.*?):(\d+):(\d+)$/,
];

const parseDiagnosticLine = (line: string, source: "stdout" | "stderr"): SelfHealingDiagnostic | null => {
  for (const pattern of diagnosticPatterns) {
    const match = pattern.exec(line.trim());
    if (!match) continue;
    if (pattern === diagnosticPatterns[0]) {
      return {
        source,
        file: match[1] || null,
        line: match[2] ? Number(match[2]) : null,
        column: match[3] ? Number(match[3]) : null,
        code: match[4] ?? null,
        message: match[5] ?? "",
      };
    }
    if (pattern === diagnosticPatterns[1]) {
      return {
        source,
        file: match[1] || null,
        line: Number(match[2]),
        column: Number(match[3]),
        code: null,
        message: match[4] ?? "",
      };
    }
    if (pattern === diagnosticPatterns[2]) {
      return {
        source,
        file: match[1] || null,
        line: Number(match[2]),
        column: null,
        code: null,
        message: match[3] ?? "",
      };
    }
    return {
      source,
      file: match[2] || null,
      line: Number(match[3]),
      column: Number(match[4]),
      code: null,
      message: match[1] ?? "",
    };
  }
  return null;
};

export const parseSelfHealingDiagnostics = (result: ProcessSandboxResult): readonly SelfHealingDiagnostic[] => {
  const diagnostics: SelfHealingDiagnostic[] = [];
  for (const source of ["stdout", "stderr"] as const) {
    for (const line of result[source].split(/\r?\n/)) {
      const diagnostic = parseDiagnosticLine(line, source);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }
  return diagnostics.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
};

const failed = (result: ProcessSandboxResult): boolean =>
  result.exitCode !== 0 || result.timedOut || result.memoryExceeded;

export class SelfHealingController {
  private readonly maxAttempts: number;

  constructor(
    private readonly toolExecutor: AgentToolExecutor,
    private readonly planner: SelfHealingPlanner,
    options: { readonly maxAttempts?: number } = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 3) {
      throw new RangeError("maxAttempts must be an integer between 1 and 3");
    }
  }

  async run(input: {
    readonly runId: string;
    readonly intentId: string;
    readonly agentId: string;
    readonly cwd: string;
    readonly role?: AgentRole;
    readonly executeTest: () => Promise<ProcessSandboxResult>;
  }): Promise<SelfHealingResult> {
    let result = await input.executeTest();
    const attempts: SelfHealingAttempt[] = [];
    let previousRepairAuditHash: string | null = null;

    while (failed(result) && attempts.length < this.maxAttempts) {
      const evidenceHash = failureEvidenceHash(result);
      const diagnostics = parseSelfHealingDiagnostics(result);
      const repairCall = await this.planner.plan({
        runId: input.runId,
        attempt: attempts.length + 1,
        failure: result,
        diagnostics,
        failureEvidenceHash: evidenceHash,
        previousRepairAuditHash,
      });

      if (repairCall === null) throw new SelfHealingExhaustedError(attempts, result);

      const execution = await this.toolExecutor.execute({
        call: repairCall,
        stepId: `self-heal:${input.runId}:${attempts.length + 1}`,
        runId: input.runId,
        role: input.role ?? "coder",
      });

      const repairAudit: ToolAuditRecord = execution.audit;
      const repairProof = sha256(`${evidenceHash}:${repairAudit.auditHash}`);
      attempts.push(Object.freeze({
        attempt: attempts.length + 1,
        failureEvidenceHash: evidenceHash,
        repairAuditSequence: repairAudit.sequence,
        repairAuditHash: repairAudit.auditHash,
        repairEvidenceHash: repairProof,
        diagnostics,
      }));
      previousRepairAuditHash = repairAudit.auditHash;
      result = await input.executeTest();
    }

    if (failed(result)) throw new SelfHealingExhaustedError(attempts, result);
    return Object.freeze({ attempts: [...attempts], finalResult: result });
  }
}
