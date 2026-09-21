export type ErrorCode =
  | "STATE_CONFLICT"
  | "INVALID_TRANSITION"
  | "BREAKER_ACTIVE"
  | "GUARD_FAILED"
  | "ENVELOPE_EXPIRED"
  | "CAPABILITY_DENIED"
  | "BUDGET_EXCEEDED"
  | "INVALID_TTL"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_EXPIRED"
  | "CREDENTIAL_INVALID"
  | "WORKER_UNAVAILABLE"
  | "NO_CAPABLE_WORKER"
  | "ANOMALY_DETECTED"
  | "LEDGER_INTEGRITY_FAILURE"
  | "DUPLICATE_IDEMPOTENCY_KEY"
  | "TENANT_HALTED"
  | "IDEMPOTENCY_CONFLICT"
  | "SANDBOX_FAILURE"
  | "RESOURCE_EXHAUSTED"
  | "SANDBOX_NOT_FOUND"
  | "INVALID_SANDBOX_TRANSITION";

export class ControlPlaneError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ControlPlaneError";
  }
}
