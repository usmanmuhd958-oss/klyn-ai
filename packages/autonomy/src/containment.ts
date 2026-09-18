import { BudgetLedger } from "./budget-ledger.js";
import type { ContainmentDecision, UsageMetrics } from "./types.js";

export class AutonomyContainmentError extends Error {
  public constructor(message: string, public readonly decision: ContainmentDecision) {
    super(message);
    this.name = "AutonomyContainmentError";
  }
}

export interface ContainmentHandlers {
  readonly onWarn?: (decision: ContainmentDecision) => void | Promise<void>;
  readonly onEscalate?: (decision: ContainmentDecision) => boolean | Promise<boolean>;
  readonly onTerminate?: (decision: ContainmentDecision) => void | Promise<void>;
}

export class RealTimeContainmentInterceptor {
  private terminated = false;

  public constructor(
    private readonly ledger: BudgetLedger,
    private readonly handlers: ContainmentHandlers = {},
  ) {}

  public isTerminated(): boolean {
    return this.terminated || this.ledger.isTerminated();
  }

  public async intercept(delta: UsageMetrics, nowEpochMs = Date.now()): Promise<ContainmentDecision> {
    if (this.isTerminated()) {
      const decision = this.ledger.terminate("containment interceptor is already terminated", nowEpochMs);
      throw new AutonomyContainmentError(decision.reason, decision);
    }

    const decision = this.ledger.record(delta, nowEpochMs);

    if (decision.action === "WARN") {
      await this.handlers.onWarn?.(decision);
      return decision;
    }

    if (decision.action === "ESCALATE") {
      const approved = await this.handlers.onEscalate?.(decision);
      if (approved === true) return decision;
      const terminated = this.ledger.terminate("escalation was not approved", nowEpochMs);
      this.terminated = true;
      await this.handlers.onTerminate?.(terminated);
      throw new AutonomyContainmentError(terminated.reason, terminated);
    }

    if (decision.action === "TERMINATE") {
      this.terminated = true;
      await this.handlers.onTerminate?.(decision);
      throw new AutonomyContainmentError(decision.reason, decision);
    }

    return decision;
  }

  public async monitor(
    stream: AsyncIterable<UsageMetrics>,
    signal: AbortSignal,
  ): Promise<void> {
    for await (const delta of stream) {
      if (signal.aborted || this.isTerminated()) return;
      await this.intercept(delta);
    }
  }

  public terminate(reason: string, nowEpochMs = Date.now()): ContainmentDecision {
    const decision = this.ledger.terminate(reason, nowEpochMs);
    this.terminated = true;
    void this.handlers.onTerminate?.(decision);
    return decision;
  }
}
