import type { RuntimeExecutionResult } from "@klyn/runtime";
import type {
  AutonomyRiskLevel,
  BudgetLedger,
  ContainmentDecision,
  UsageMetrics,
} from "@klyn/autonomy";
import type {
  ControlPlaneExecutionRequest,
  ExecutionControllerOptions,
  ExecutionReport,
} from "./types.js";

const RISK_RANK: Readonly<Record<AutonomyRiskLevel, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

export class ExecutionBoundaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionBoundaryError";
  }
}

function runtimeUsage(result: RuntimeExecutionResult): UsageMetrics {
  return Object.freeze({
    tokens: 0,
    computeMillis: result.observation.usage.cpuMillis,
    networkRequests: result.observation.usage.networkRequests,
    financialSpendMinorUnits: 0n,
    toolInvocations: 1,
    wallClockMillis: result.observation.usage.wallClockMillis,
  });
}

function permissionAllowed(
  budget: BudgetLedger,
  input: ControlPlaneExecutionRequest,
): boolean {
  const envelope = budget.envelopeSnapshot;
  const request = input.authorizationRequest;
  const risk = request.risk as AutonomyRiskLevel;

  if (RISK_RANK[risk] > RISK_RANK[envelope.maxRisk]) return false;

  return envelope.allowedTools.some((permission) => {
    if (permission.toolName !== request.toolName) return false;
    if (!permission.operations.includes(request.operation)) return false;
    return RISK_RANK[risk] <= RISK_RANK[permission.maxRisk];
  });
}

function identityCheck(input: ControlPlaneExecutionRequest, budget: BudgetLedger): void {
  if (input.intent.missionId !== budget.missionId) {
    throw new ExecutionBoundaryError("intent missionId does not match autonomy envelope");
  }
  if (input.intent.objectiveId !== input.authorizationRequest.objectiveId) {
    throw new ExecutionBoundaryError("intent objectiveId does not match authorization request");
  }
  if (input.intent.requestedTool !== input.authorizationRequest.toolName) {
    throw new ExecutionBoundaryError("intent tool does not match authorization request");
  }
  if (input.intent.requestedOperation !== input.authorizationRequest.operation) {
    throw new ExecutionBoundaryError("intent operation does not match authorization request");
  }
  if (input.intent.statement.trim().length === 0) {
    throw new ExecutionBoundaryError("intent statement is required");
  }
  if (budget.envelopeSnapshot.principalId !== input.authorizationRequest.principal.principalId) {
    throw new ExecutionBoundaryError("authorization principal does not match autonomy envelope");
  }
  if (budget.envelopeSnapshot.expiresAtEpochMs <= budget.envelopeSnapshot.issuedAtEpochMs) {
    throw new ExecutionBoundaryError("autonomy envelope has invalid expiry");
  }
}

export class ExecutionController {
  public constructor(private readonly options: ExecutionControllerOptions) {}

  public async execute(input: ControlPlaneExecutionRequest): Promise<ExecutionReport> {
    identityCheck(input, this.options.budget);
    this.options.containment.assertOperational();

    if (!permissionAllowed(this.options.budget, input)) {
      throw new ExecutionBoundaryError(
        "autonomy permission envelope denied tool/operation/risk scope",
      );
    }

    const authorization = this.options.governance.authorize(
      input.authorizationRequest,
      input.authorizationScopes,
    );
    if (!authorization.allowed) {
      throw new ExecutionBoundaryError("governance denied execution: " + authorization.reason);
    }

    const budgetAdmission = this.options.budget.admit(input.estimatedUsage);
    if (!budgetAdmission.admitted) {
      throw new ExecutionBoundaryError("autonomy budget admission denied: " + budgetAdmission.reason);
    }

    this.options.containment.assertOperational();

    const abortController = new AbortController();
    let monitorFailure: unknown;

    const monitorPromise = input.usageStream === undefined
      ? Promise.resolve()
      : this.options.containment.monitor(input.usageStream, abortController.signal)
          .catch((error: unknown) => {
            monitorFailure = error;
            abortController.abort(error);
          });

    let runtime: RuntimeExecutionResult;
    try {
      runtime = await this.options.runtime.execute(input.task, abortController.signal);
    } catch (error: unknown) {
      abortController.abort(error);
      await monitorPromise.catch(() => undefined);
      if (monitorFailure !== undefined) throw monitorFailure;
      throw error;
    } finally {
      abortController.abort();
    }

    await monitorPromise.catch(() => undefined);
    if (monitorFailure !== undefined) throw monitorFailure;

    const finalUsageDelta = input.finalUsageDelta ?? (
      input.usageStream === undefined
        ? runtimeUsage(runtime)
        : Object.freeze({
            tokens: 0,
            computeMillis: 0,
            networkRequests: 0,
            financialSpendMinorUnits: 0n,
            toolInvocations: 0,
            wallClockMillis: 0,
          })
    );

    await this.options.containment.intercept(finalUsageDelta);

    return Object.freeze({
      authorization,
      budgetAdmission,
      runtime,
      containment: Object.freeze([...this.options.containment.recentDecisions()]),
      budget: this.options.budget.snapshot(),
    });
  }
}
