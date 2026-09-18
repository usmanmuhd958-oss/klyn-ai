import { ControlPlaneError } from "./errors.js";
import { newCredentialId } from "./ids.js";
import { randomToken, sha256 } from "./crypto.js";
import type { Capability, CredentialGrant, CredentialMinter, CredentialRequest, ExecutionId, ResourceEnvelope } from "./types.js";

export interface CredentialValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

interface StoredGrant {
  readonly grant: Omit<CredentialGrant, "token">;
  readonly tokenHash: string;
  readonly revoked: boolean;
}

export class CredentialBroker {
  private readonly grants = new Map<string, StoredGrant>();

  constructor(private readonly minter: CredentialMinter) {}

  async issue(request: CredentialRequest, envelope: ResourceEnvelope): Promise<CredentialGrant> {
    if (request.executionId !== envelope.executionId) throw new ControlPlaneError("CAPABILITY_DENIED", "EXECUTION_ID_MISMATCH");
    if (!Number.isInteger(request.ttlSeconds) || request.ttlSeconds <= 0 || request.ttlSeconds > 900) throw new ControlPlaneError("INVALID_TTL", "CREDENTIAL_TTL_MUST_BE_1_TO_900_SECONDS");
    const allowed = new Set(envelope.allowedCapabilities.map((capability) => capabilityScope(capability)));
    for (const scope of request.scopes) if (!allowed.has(scope)) throw new ControlPlaneError("CAPABILITY_DENIED", `SCOPE_NOT_ALLOWED:${scope}`);

    const now = new Date();
    const requestedExpiry = new Date(now.getTime() + request.ttlSeconds * 1000);
    const envelopeExpiry = new Date(envelope.expiresAt);
    const expiresAt = requestedExpiry < envelopeExpiry ? requestedExpiry : envelopeExpiry;
    if (expiresAt <= now) throw new ControlPlaneError("ENVELOPE_EXPIRED", "ENVELOPE_EXPIRES_BEFORE_CREDENTIAL");

    const minted = await this.minter.mint(request);
    if (!minted.token) throw new ControlPlaneError("CREDENTIAL_INVALID", "CREDENTIAL_MINTER_RETURNED_EMPTY_TOKEN");

    const grant = Object.freeze({
      credentialId: newCredentialId(),
      executionId: request.executionId,
      provider: request.provider,
      scopes: Object.freeze([...request.scopes]),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      audience: request.audience,
      nonce: randomToken(24),
      token: minted.token,
    });

    const metadata: Omit<CredentialGrant, "token"> = Object.freeze({
      credentialId: grant.credentialId,
      executionId: grant.executionId,
      provider: grant.provider,
      scopes: grant.scopes,
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAt,
      audience: grant.audience,
      nonce: grant.nonce,
    });
    this.grants.set(grant.credentialId, {
      grant: metadata,
      tokenHash: await sha256(grant.token),
      revoked: false,
    });
    return grant;
  }

  async validate(credentialId: CredentialGrant["credentialId"], token: string, executionId: ExecutionId, scope: string, nowMs = Date.now()): Promise<CredentialValidation> {
    const stored = this.grants.get(credentialId);
    if (!stored) return { valid: false, reason: "UNKNOWN_CREDENTIAL" };
    if (stored.revoked) return { valid: false, reason: "CREDENTIAL_REVOKED" };
    if (stored.grant.executionId !== executionId) return { valid: false, reason: "EXECUTION_ID_MISMATCH" };
    if (Date.parse(stored.grant.expiresAt) <= nowMs) return { valid: false, reason: "CREDENTIAL_EXPIRED" };
    if (!stored.grant.scopes.includes(scope)) return { valid: false, reason: "SCOPE_DENIED" };
    const tokenHash = await sha256(token);
    if (tokenHash !== stored.tokenHash) return { valid: false, reason: "TOKEN_MISMATCH" };
    return { valid: true };
  }

  revoke(credentialId: CredentialGrant["credentialId"]): void {
    const stored = this.grants.get(credentialId);
    if (!stored) return;
    this.grants.set(credentialId, { ...stored, revoked: true });
  }
}

function capabilityScope(capability: Capability): string {
  return capability;
}
