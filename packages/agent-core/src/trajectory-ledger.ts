import type { ToolAuditRecord } from "@klyn/execution-runtime";
import type { AgentRole, AgentTrajectoryStep } from "./contracts.js";

export interface TrajectoryRecordInput {
  readonly stepId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly intentId: string;
  readonly audit: ToolAuditRecord;
}

export class AgentTrajectoryLedger {
  private readonly steps: AgentTrajectoryStep[] = [];
  private readonly stepIds = new Set<string>();

  append(input: TrajectoryRecordInput): AgentTrajectoryStep {
    if (this.stepIds.has(input.stepId)) throw new Error(`Duplicate trajectory step: ${input.stepId}`);
    const previous = this.steps[this.steps.length - 1];
    if (previous && input.audit.previousAuditHash !== previous.auditHash) {
      throw new Error(`Audit discontinuity for trajectory step: ${input.stepId}`);
    }
    if (input.audit.agentId !== input.agentId || input.audit.intentId !== input.intentId) {
      throw new Error(`Audit identity mismatch for trajectory step: ${input.stepId}`);
    }
    const step: AgentTrajectoryStep = Object.freeze({
      stepId: input.stepId,
      runId: input.runId,
      agentId: input.agentId,
      role: input.role,
      intentId: input.intentId,
      auditSequence: input.audit.sequence,
      auditHash: input.audit.auditHash,
      requestHash: input.audit.requestHash,
      resultHash: input.audit.resultHash,
    });
    this.stepIds.add(input.stepId);
    this.steps.push(step);
    return step;
  }

  snapshot(): readonly AgentTrajectoryStep[] {
    return this.steps.map((step) => ({ ...step }));
  }
}
