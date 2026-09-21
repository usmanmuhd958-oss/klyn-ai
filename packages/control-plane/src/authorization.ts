import { ControlPlaneError } from "./errors.js";
import type { ActorIdentity, AuthorizationContext, Capability, PolicyId, ResourceEnvelope } from "./types.js";

export interface PolicyRule {
  readonly policyId: PolicyId;
  readonly actorTypes: readonly ActorIdentity["principalType"][];
  readonly allowedCapabilities: readonly Capability[];
}

export interface AuthorizationRequest {
  readonly actor: ActorIdentity;
  readonly policyId: PolicyId;
  readonly requestedCapabilities: readonly Capability[];
  readonly expiresAt: string;
  readonly decisionId: string;
}

export class PolicyAuthorizationEngine {
  private readonly policies = new Map<string, PolicyRule>();

  register(policy: PolicyRule): void {
    if (policy.allowedCapabilities.length === 0) throw new ControlPlaneError("CAPABILITY_DENIED", "POLICY_HAS_NO_CAPABILITIES");
    this.policies.set(policy.policyId, Object.freeze({ ...policy, allowedCapabilities: Object.freeze([...policy.allowedCapabilities]) }));
  }

  authorize(request: AuthorizationRequest): AuthorizationContext {
    const policy = this.policies.get(request.policyId);
    if (!policy) throw new ControlPlaneError("CAPABILITY_DENIED", "POLICY_NOT_FOUND");
    if (!policy.actorTypes.includes(request.actor.principalType)) throw new ControlPlaneError("CAPABILITY_DENIED", "PRINCIPAL_TYPE_NOT_ALLOWED");
    if (Date.parse(request.expiresAt) <= Date.now()) throw new ControlPlaneError("CAPABILITY_DENIED", "AUTHORIZATION_EXPIRED");
    const allowed = new Set(policy.allowedCapabilities);
    for (const capability of request.requestedCapabilities) {
      if (!allowed.has(capability)) throw new ControlPlaneError("CAPABILITY_DENIED", `CAPABILITY_NOT_ALLOWED:${capability}`);
    }
    return Object.freeze({
      policyId: policy.policyId,
      decisionId: request.decisionId,
      expiresAt: new Date(request.expiresAt).toISOString(),
      capabilities: Object.freeze([...request.requestedCapabilities]),
    });
  }

  assertEnvelopeCapabilities(context: AuthorizationContext, envelope: ResourceEnvelope): void {
    if (context.policyId !== envelope.signaturePolicyId) throw new ControlPlaneError("CAPABILITY_DENIED", "ENVELOPE_POLICY_MISMATCH");
    const authorized = new Set(context.capabilities);
    for (const capability of envelope.allowedCapabilities) {
      if (!authorized.has(capability)) throw new ControlPlaneError("CAPABILITY_DENIED", `ENVELOPE_CAPABILITY_ESCALATION:${capability}`);
    }
    if (Date.parse(context.expiresAt) <= Date.now()) throw new ControlPlaneError("CAPABILITY_DENIED", "AUTHORIZATION_EXPIRED");
  }
}
