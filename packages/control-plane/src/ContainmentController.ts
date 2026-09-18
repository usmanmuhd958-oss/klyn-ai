import { digestJson } from "@klyn/governance";
import type { AuditEvent, AuditLedger } from "@klyn/governance";
import {
  RealTimeContainmentInterceptor,
  type ContainmentHandlers,
} from "@klyn/autonomy";
import type { BudgetLedger, ContainmentDecision, UsageMetrics } from "@klyn/autonomy";
import type { ControlPlaneContainmentOptions } from "./types.js";

function decisionDigest(decision: ContainmentDecision): string {
  return digestJson({
    action: decision.action,
    reason: decision.reason,
    breachedDimensions: decision.breachedDimensions,
    usage: {
      tokens: decision.usage.tokens,
      computeMillis: decision.usage.computeMillis,
      networkRequests: decision.usage.networkRequests,
      financialSpendMinorUnits: decision.usage.financialSpendMinorUnits.toString(),
      toolInvocations: decision.usage.toolInvocations,
      wallClockMillis: decision.usage.wallClockMillis,
    },
    remaining: {
      tokens: decision.remaining.tokens,
      computeMillis: decision.remaining.computeMillis,
      networkRequests: decision.remaining.networkRequests,
      financialSpendMinorUnits: decision.remaining.financialSpendMinorUnits.toString(),
      toolInvocations: decision.remaining.toolInvocations,
      wallClockMillis: decision.remaining.wallClockMillis,
    },
    sequence: decision.sequence,
    evaluatedAtEpochMs: decision.evaluatedAtEpochMs,
  });
}

export class ContainmentController {
  private readonly interceptor: RealTimeContainmentInterceptor;
  private readonly decisions: ContainmentDecision[] = [];

  public constructor(private readonly options: ControlPlaneContainmentOptions) {
    const handlers: ContainmentHandlers = {
      onWarn: (decision) => {
        this.record(decision);
      },
      onEscalate: async (decision) => {
        this.record(decision);
        return (await options.onEscalate?.(decision)) ?? false;
      },
      onTerminate: async (decision) => {
        this.record(decision);
        await options.onTerminate?.(decision);
      },
    };
    this.interceptor = new RealTimeContainmentInterceptor(options.budget, handlers);
  }

  public get budget(): BudgetLedger {
    return this.options.budget;
  }

  public isTerminated(): boolean {
    return this.interceptor.isTerminated();
  }

  public assertOperational(): void {
    if (this.isTerminated()) throw new Error("control-plane containment is terminated");
  }

  public recentDecisions(): readonly ContainmentDecision[] {
    return Object.freeze([...this.decisions]);
  }

  public intercept(delta: UsageMetrics, nowEpochMs = Date.now()): Promise<ContainmentDecision> {
    return this.interceptor.intercept(delta, nowEpochMs);
  }

  public monitor(stream: AsyncIterable<UsageMetrics>, signal: AbortSignal): Promise<void> {
    return this.interceptor.monitor(stream, signal);
  }

  public terminate(reason: string, nowEpochMs = Date.now()): ContainmentDecision {
    return this.interceptor.terminate(reason, nowEpochMs);
  }

  private record(decision: ContainmentDecision): void {
    this.decisions.push(decision);
    const event: AuditEvent = {
      kind: "containment",
      missionId: this.options.missionId,
      agentId: this.options.agentId,
      principalId: this.options.principalId,
      action: decision.action,
      reason: decision.reason,
      breachedDimensions: decision.breachedDimensions,
      budgetSequence: decision.sequence,
      decisionDigest: decisionDigest(decision),
      timestampEpochMs: decision.evaluatedAtEpochMs,
    };
    const audit: AuditLedger = this.options.governance.audit;
    audit.append(event);
  }
}
