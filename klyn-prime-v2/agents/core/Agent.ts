import { AgentIdentity } from "./AgentIdentity";
import { AgentCapability } from "./AgentCapability";
import { InputValidator, ValidationResult } from "../security/InputValidator";
import { AuditLogger } from "../security/AuditLogger";
import { SecurityPolicy, DEFAULT_SECURITY_POLICY } from "../security/SecurityPolicy";

export interface ExecutionResult {
  agent: string;
  result: string;
  sanitizedTask: string;
  durationMs: number;
  success: boolean;
}

export class Agent {
  private static readonly auditLogger = AuditLogger.getInstance();
  private static readonly policy: SecurityPolicy = DEFAULT_SECURITY_POLICY;

  constructor(
    private identity: AgentIdentity,
    private capability: AgentCapability,
    private principal: string = "system"
  ) {}

  async execute(task: unknown): Promise<ExecutionResult> {
    const startTime = performance.now();

    const validation = InputValidator.validateTask(task);
    if (!validation.valid) {
      Agent.auditLogger.log({
        principal: this.principal,
        action: "agent.execute",
        resource: this.identity.id,
        outcome: "denied",
        metadata: { errors: validation.errors, taskLength: String(task).length },
      });

      throw new Error(`Task validation failed: ${validation.errors.join(", ")}`);
    }

    if (Agent.policy.requireCapabilityCheck && !this.capability.canExecute(validation.sanitized)) {
      Agent.auditLogger.log({
        principal: this.principal,
        action: "agent.execute",
        resource: this.identity.id,
        outcome: "denied",
        metadata: { reason: "capability_check_failed", task: validation.sanitized.substring(0, 128) },
      });

      throw new Error("Agent capability missing for sanitized task");
    }

    Agent.auditLogger.log({
      principal: this.principal,
      action: "agent.execute",
      resource: this.identity.id,
      outcome: "success",
      metadata: { taskPreview: validation.sanitized.substring(0, 128) },
    });

    const durationMs = performance.now() - startTime;

    return {
      agent: this.identity.name,
      result: `Executed ${validation.sanitized.substring(0, 256)}`,
      sanitizedTask: validation.sanitized,
      durationMs,
      success: true,
    };
  }

  getIdentity(): AgentIdentity {
    return this.identity;
  }

  getCapability(): AgentCapability {
    return this.capability;
  }

  getPrincipal(): string {
    return this.principal;
  }
}
