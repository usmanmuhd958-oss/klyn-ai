import { ControlPlaneError } from "./errors.js";
import { newSandboxId } from "./ids.js";
import type { Capability, ComputeBudget, ExecutionId, NetworkPolicy, ResourceEnvelope, SandboxId } from "./types.js";

export type SandboxKind = "CONTAINER" | "MICROVM";
export type SandboxState = "ALLOCATING" | "STARTING" | "READY" | "EXECUTING" | "DRAINING" | "DESTROYED" | "FAILED";

export interface SandboxSpec {
  readonly sandboxId: SandboxId;
  readonly executionId: ExecutionId;
  readonly kind: SandboxKind;
  readonly compute: ComputeBudget;
  readonly networkPolicy: NetworkPolicy;
  readonly capabilities: readonly Capability[];
  readonly rootFsDigest: string;
  readonly seccompProfile: string;
  readonly apparmorProfile?: string;
}

export interface SandboxDriver {
  create(spec: SandboxSpec): Promise<void>;
  start(sandboxId: SandboxId): Promise<void>;
  beginExecution(sandboxId: SandboxId): Promise<void>;
  stop(sandboxId: SandboxId): Promise<void>;
  destroy(sandboxId: SandboxId): Promise<void>;
}

const TRANSITIONS: Record<SandboxState, readonly SandboxState[]> = {
  ALLOCATING: ["STARTING", "FAILED"],
  STARTING: ["READY", "FAILED"],
  READY: ["EXECUTING", "DRAINING", "FAILED"],
  EXECUTING: ["DRAINING", "FAILED"],
  DRAINING: ["DESTROYED", "FAILED"],
  DESTROYED: [],
  FAILED: ["DRAINING", "DESTROYED"],
};

export interface SandboxHandle {
  readonly sandboxId: SandboxId;
  readonly executionId: ExecutionId;
  readonly kind: SandboxKind;
  readonly state: SandboxState;
}

export class SandboxManager {
  private readonly handles = new Map<string, SandboxHandle>();

  constructor(private readonly driver: SandboxDriver) {}

  async create(envelope: ResourceEnvelope, spec: Omit<SandboxSpec, "sandboxId" | "executionId" | "compute" | "networkPolicy" | "capabilities">): Promise<SandboxHandle> {
    this.assertEnvelopeForSandbox(envelope);
    const sandboxId = newSandboxId();
    const fullSpec: SandboxSpec = {
      ...spec,
      sandboxId,
      executionId: envelope.executionId,
      compute: envelope.computeBudget,
      networkPolicy: envelope.networkPolicy,
      capabilities: envelope.allowedCapabilities,
    };
    await this.driver.create(fullSpec).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : "UNKNOWN_DRIVER_FAILURE";
      this.handles.set(sandboxId, { sandboxId, executionId: envelope.executionId, kind: spec.kind, state: "FAILED" });
      throw new ControlPlaneError("SANDBOX_FAILURE", reason);
    });
    const handle = { sandboxId, executionId: envelope.executionId, kind: spec.kind, state: "STARTING" as const };
    this.handles.set(sandboxId, handle);
    return handle;
  }

  async start(sandboxId: SandboxId): Promise<SandboxHandle> {
    const current = this.require(sandboxId);
    this.assertTransition(current.state, "READY");
    await this.driver.start(sandboxId).catch((error: unknown) => this.fail(sandboxId, error));
    return this.update(current, "READY");
  }

  async beginExecution(sandboxId: SandboxId): Promise<SandboxHandle> {
    const current = this.require(sandboxId);
    this.assertTransition(current.state, "EXECUTING");
    await this.driver.beginExecution(sandboxId).catch((error: unknown) => this.fail(sandboxId, error));
    return this.update(current, "EXECUTING");
  }

  async drain(sandboxId: SandboxId): Promise<SandboxHandle> {
    const current = this.require(sandboxId);
    this.assertTransition(current.state, "DRAINING");
    await this.driver.stop(sandboxId).catch((error: unknown) => this.fail(sandboxId, error));
    return this.update(current, "DRAINING");
  }

  async destroy(sandboxId: SandboxId): Promise<SandboxHandle> {
    const current = this.require(sandboxId);
    this.assertTransition(current.state, "DESTROYED");
    await this.driver.destroy(sandboxId).catch((error: unknown) => this.fail(sandboxId, error));
    return this.update(current, "DESTROYED");
  }

  get(sandboxId: SandboxId): SandboxHandle | undefined { return this.handles.get(sandboxId); }

  private assertEnvelopeForSandbox(envelope: ResourceEnvelope): void {
    if (Date.parse(envelope.expiresAt) <= Date.now()) throw new ControlPlaneError("ENVELOPE_EXPIRED", "SANDBOX_CANNOT_START_WITH_EXPIRED_ENVELOPE");
    if (envelope.tokenBudget.totalMax <= 0n) throw new ControlPlaneError("RESOURCE_EXHAUSTED", "SANDBOX_REQUIRES_POSITIVE_TOKEN_BUDGET");
  }

  private require(sandboxId: SandboxId): SandboxHandle {
    const handle = this.handles.get(sandboxId);
    if (!handle) throw new ControlPlaneError("SANDBOX_NOT_FOUND", sandboxId);
    return handle;
  }

  private assertTransition(from: SandboxState, to: SandboxState): void {
    if (!TRANSITIONS[from].includes(to)) throw new ControlPlaneError("INVALID_SANDBOX_TRANSITION", `${from}->${to}`);
  }

  private update(current: SandboxHandle, state: SandboxState): SandboxHandle {
    const next = { ...current, state };
    this.handles.set(current.sandboxId, next);
    return next;
  }

  private fail(sandboxId: SandboxId, error: unknown): never {
    const current = this.require(sandboxId);
    this.handles.set(sandboxId, { ...current, state: "FAILED" });
    const reason = error instanceof Error ? error.message : "UNKNOWN_DRIVER_FAILURE";
    throw new ControlPlaneError("SANDBOX_FAILURE", reason);
  }
}
