import type { HermeticToolCall, HermeticToolResult, ToolAuditRecord, ToolExecutionKernel } from "@klyn/execution-runtime";
import { AgentTrajectoryLedger } from "./trajectory-ledger.js";
import type { AgentRole } from "./contracts.js";

export interface AgentToolExecutionResult {
  readonly result: HermeticToolResult;
  readonly audit: ToolAuditRecord;
}

export class AgentToolExecutor {
  constructor(
    private readonly kernel: ToolExecutionKernel,
    private readonly trajectory: AgentTrajectoryLedger,
  ) {}

  async execute(input: {
    readonly call: HermeticToolCall;
    readonly stepId: string;
    readonly runId: string;
    readonly role: AgentRole;
  }): Promise<AgentToolExecutionResult> {
    const execution = await this.kernel.execute(input.call);
    this.trajectory.append({
      stepId: input.stepId,
      runId: input.runId,
      agentId: input.call.agentId,
      role: input.role,
      intentId: input.call.intentId,
      audit: execution.audit,
    });
    return execution;
  }
}
