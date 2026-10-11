import { createHash, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { isIP } from "node:net";

/**
 * KLYN OS Object-Capability protocol v1.
 *
 * This module defines signed, attenuable authority. It deliberately does not expose
 * OS paths, sockets, file descriptors, process handles, or private keys in tokens.
 * Actual isolation is supplied by the native/runtime broker implementing
 * CapabilityInvocationPipeline and CapabilitySandboxEnforcer.
 */
export const CAPABILITY_TOKEN_SCHEMA = "urn:klyn:capability-token:v1" as const;
export const CAPABILITY_EVIDENCE_SCHEMA = "urn:klyn:capability-evidence:v1" as const;
export const CAPABILITY_ATTESTATION_SCHEMA = "urn:klyn:capability-preexecution-attestation:v1" as const;

export type CapabilityResourceKind = "filesystem" | "network" | "process" | "memory" | "ipc";
export type CapabilityOperation =
  | "fs.read" | "fs.list" | "fs.metadata" | "fs.write" | "fs.create" | "fs.delete"
  | "net.resolve" | "net.connect" | "net.send" | "net.receive"
  | "process.spawn" | "process.inspect" | "process.signal" | "process.terminate"
  | "memory.read" | "memory.write"
  | "ipc.send" | "ipc.receive";

export interface CapabilityScopeBase<K extends CapabilityResourceKind, O extends CapabilityOperation> {
  readonly kind: K;
  /** Random broker handle ID, never a raw OS handle or ambient resource name. */
  readonly handleId: string;
  /** Stable resource identity inside the trusted broker's registry. */
  readonly resourceId: string;
  readonly operations: readonly O[];
}

export interface FileSystemCapabilityScope extends CapabilityScopeBase<
  "filesystem", "fs.read" | "fs.list" | "fs.metadata" | "fs.write" | "fs.create" | "fs.delete"
> {
  /** Canonical relative path prefix resolved beneath the registered root handle; empty grants its subtree. */
  readonly relativePathPrefix: string;
  readonly maxBytesPerInvocation: number;
}

export interface NetworkCapabilityScope extends CapabilityScopeBase<
  "network", "net.resolve" | "net.connect" | "net.send" | "net.receive"
> {
  /** Exact, normalized DNS names or IP literals. Wildcards, URL strings and implicit public-network access are forbidden. */
  readonly hosts: readonly string[];
  readonly ports: readonly PortRange[];
  readonly maxBytesPerInvocation: number;
}

export interface PortRange {
  readonly first: number;
  readonly last: number;
}

export interface ProcessCapabilityScope extends CapabilityScopeBase<
  "process", "process.spawn" | "process.inspect" | "process.signal" | "process.terminate"
> {
  /** Lower-case SHA-256 hex digests of approved executable contents. */
  readonly executableSha256: readonly string[];
  /** Each permitted argv prefix is explicit; no shell expansion is implied. */
  readonly argvPrefixes: readonly (readonly string[])[];
  /** Only these environment variable names may be forwarded. Values remain runtime policy controlled. */
  readonly environmentKeys: readonly string[];
  readonly maxProcesses: number;
}

export interface MemoryCapabilityScope extends CapabilityScopeBase<"memory", "memory.read" | "memory.write"> {
  readonly regionIds: readonly string[];
  readonly maxBytesPerInvocation: number;
}

export interface IpcCapabilityScope extends CapabilityScopeBase<"ipc", "ipc.send" | "ipc.receive"> {
  readonly channelIds: readonly string[];
  readonly peerPrincipalIds: readonly string[];
  readonly maxMessageBytes: number;
}

export type CapabilityScope =
  | FileSystemCapabilityScope
  | NetworkCapabilityScope
  | ProcessCapabilityScope
  | MemoryCapabilityScope
  | IpcCapabilityScope;

export interface CapabilityBudget {
  /** Total admitted invocation count for the token, including failed execution attempts. */
  readonly maxInvocations: number;
  /** Maximum simultaneously admitted invocations. */
  readonly maxConcurrentInvocations: number;
  readonly maxWallClockMsPerInvocation: number;
  readonly maxCpuMsPerInvocation: number;
  readonly maxMemoryBytes: number;
  readonly maxNetworkBytes: number;
  readonly maxOutputBytes: number;
  readonly maxProcesses: number;
  /** Integer minor units, such as cents; avoid floating-point currency. */
  readonly maxFinancialSpendMinorUnits: number;
}

export interface CapabilityDelegationPolicy {
  readonly enabled: boolean;
  /** Maximum absolute depth including this token. Zero disables child capabilities. */
  readonly maxDepth: number;
  /** Exact identities that may receive a child token. No wildcard is permitted. */
  readonly allowedDelegatePrincipalIds: readonly string[];
}

export interface CapabilityTokenV1 {
  readonly schema: typeof CAPABILITY_TOKEN_SCHEMA;
  readonly tokenId: string;
  readonly issuerPrincipalId: string;
  readonly subjectPrincipalId: string;
  /** Exact runtime/tenant audience; token cannot be replayed against another audience. */
  readonly audience: string;
  readonly nonce: string;
  readonly issuedAtEpochMs: number;
  readonly notBeforeEpochMs: number;
  readonly expiresAtEpochMs: number;
  /** Digest of the complete parent token, including its signature. Null only at the root grant. */
  readonly parentTokenDigest: string | null;
  readonly delegationDepth: number;
  readonly delegation: CapabilityDelegationPolicy;
  readonly scopes: readonly CapabilityScope[];
  readonly budget: CapabilityBudget;
  readonly policyDigest: string;
}

export interface CapabilitySignatureV1 {
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly signatureBase64: string;
}

/** Signed bearer representation. It is unforgeable, but not inherently non-copyable. */
export interface CapabilityToken {
  readonly payload: CapabilityTokenV1;
  readonly signature: CapabilitySignatureV1;
}

export interface CapabilityGrant {
  readonly grantId: string;
  readonly token: CapabilityToken;
  readonly grantedByPrincipalId: string;
  readonly reason: string;
  readonly createdAtEpochMs: number;
  readonly kelEvidenceId: string;
  readonly kelStatementDigest: string;
}

export interface CapabilityRevocationPayloadV1 {
  readonly schema: "urn:klyn:capability-revocation:v1";
  readonly revocationId: string;
  readonly tokenId: string;
  readonly tokenDigest: string;
  readonly revokedByPrincipalId: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly revokedAtEpochMs: number;
  readonly effectiveAtEpochMs: number;
  readonly policyDigest: string;
}

export interface CapabilityRevocation {
  readonly payload: CapabilityRevocationPayloadV1;
  readonly signature: CapabilitySignatureV1;
  readonly kelEvidenceId: string;
  readonly kelStatementDigest: string;
}

export interface AttenuationRule {
  readonly subjectPrincipalId: string;
  /** Required explicit subset. Empty scopes means no usable authority and is rejected. */
  readonly scopes: readonly CapabilityScope[];
  readonly budget: CapabilityBudget;
  /** Child expiry must be no later than its parent. */
  readonly expiresAtEpochMs: number;
  readonly delegation: CapabilityDelegationPolicy;
  readonly reason: string;
  readonly policyDigest: string;
  readonly missionId: string;
  readonly runtimeInstanceId: string;
}

export interface CapabilityTokenSigner {
  readonly keyId: string;
  signPayload(payload: unknown): CapabilitySignatureV1;
}

export interface CapabilityKeyResolver {
  resolvePublicKey(keyId: string): KeyObject | undefined;
  /** Principal identity bound to this key by the trusted key registry. */
  resolvePrincipalId(keyId: string): string | undefined;
}

export interface CapabilityTokenVerifier {
  verify(token: CapabilityToken, expectation?: CapabilityVerificationExpectation): void;
}

export interface CapabilityVerificationExpectation {
  readonly nowEpochMs?: number;
  readonly subjectPrincipalId?: string;
  readonly audience?: string;
  readonly maxClockSkewMs?: number;
}

export interface AuthorityDelegation {
  readonly parentTokenDigest: string;
  readonly childToken: CapabilityToken;
  readonly delegatedByPrincipalId: string;
  readonly delegatedToPrincipalId: string;
  readonly createdAtEpochMs: number;
  readonly kelEvidenceId: string;
  readonly kelStatementDigest: string;
}

export type CapabilityDelegation = AuthorityDelegation;

export type CapabilityEvidenceKind =
  | "capability-granted"
  | "capability-attenuated"
  | "capability-revoked"
  | "capability-invocation-authorized"
  | "capability-invocation-rejected"
  | "capability-invocation-completed";

export interface CapabilityEvidenceEvent {
  readonly schema: typeof CAPABILITY_EVIDENCE_SCHEMA;
  readonly eventId: string;
  readonly kind: CapabilityEvidenceKind;
  readonly occurredAtEpochMs: number;
  readonly principalId: string;
  readonly missionId: string;
  readonly runtimeInstanceId: string;
  readonly tokenId: string;
  readonly tokenDigest: string;
  readonly parentTokenDigest: string | null;
  readonly invocationId: string | null;
  readonly requestDigest: string | null;
  readonly policyDigest: string;
  readonly outcome: "allowed" | "denied" | "completed" | "revoked";
  readonly reasonCode: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Adapter contract to KEL v1. Implementations MUST translate each event into a
 * standard KEL EvidenceStatementV1 (normally authorization-decision or execution-started),
 * persist it through EvidenceLedger, and return its committed evidence ID and digest.
 * A memory log or best-effort console logger is not a conforming adapter.
 */
export interface CapabilityEvidenceSink {
  append(event: CapabilityEvidenceEvent): Promise<CapabilityEvidenceReceipt>;
}

export interface CapabilityEvidenceReceipt {
  readonly ledgerId: string;
  readonly evidenceId: string;
  readonly statementDigest: string;
  readonly committedAtEpochMs: number;
}

export interface CapabilityRevocationRegistry {
  /**
   * Must check the token and all ancestors by token digest, be linearizable/durable
   * across workers, and fail closed on storage error.
   */
  isRevoked(tokenId: string, tokenDigest: string, nowEpochMs: number): Promise<boolean>;
  /** Must atomically reject duplicate/conflicting revocations. */
  revoke(revocation: CapabilityRevocation): Promise<void>;
}

export interface CapabilityInvocationCounter {
  /**
   * Atomic reservation across workers. Must check revocation and quotas in the same
   * transaction or through an equivalent linearizable reservation protocol.
   */
  reserve(input: {
    readonly tokenId: string;
    readonly tokenDigest: string;
    readonly invocationId: string;
    readonly maxInvocations: number;
    readonly maxConcurrentInvocations: number;
    readonly nowEpochMs: number;
  }): Promise<CapabilityInvocationReservation>;
  finish(reservationId: string, outcome: "completed" | "failed" | "cancelled", nowEpochMs: number): Promise<void>;
}

export interface CapabilityInvocationReservation {
  readonly reservationId: string;
  readonly admittedInvocationNumber: number;
}

export interface CapabilityResourceRequest {
  readonly kind: CapabilityResourceKind;
  readonly handleId: string;
  readonly operation: CapabilityOperation;
  /** Canonical digest of arguments; secret values are not copied into KEL evidence. */
  readonly requestDigest: string;
  /** The broker resolves this against the signed scope; a caller-supplied path is never trusted alone. */
  readonly resourceSelector: Readonly<Record<string, string | number | boolean | null>>;
  readonly requestedBudgets: Partial<CapabilityBudget>;
}

export interface CapabilityInvocationRequest {
  readonly invocationId: string;
  readonly missionId: string;
  readonly principalId: string;
  readonly runtimeInstanceId: string;
  readonly audience: string;
  readonly token: CapabilityToken;
  readonly operation: CapabilityResourceRequest;
  readonly deadlineEpochMs: number;
  readonly sandboxProfileDigest: string;
}

export interface PreExecutionAttestationPayloadV1 {
  readonly schema: typeof CAPABILITY_ATTESTATION_SCHEMA;
  readonly invocationId: string;
  readonly tokenId: string;
  readonly tokenDigest: string;
  readonly principalId: string;
  readonly missionId: string;
  readonly runtimeInstanceId: string;
  readonly audience: string;
  readonly requestDigest: string;
  readonly scopeDigest: string;
  readonly policyDigest: string;
  readonly sandboxProfileDigest: string;
  readonly reservationId: string;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
}

export interface PreExecutionAttestationV1 {
  readonly payload: PreExecutionAttestationPayloadV1;
  readonly signature: CapabilitySignatureV1;
}

export interface ExecutionRuntimeCollector {
  /**
   * Signs a pre-execution decision using a runtime-controlled Ed25519 key. The key
   * MUST never be exposed to the agent or tool. This attestation is authorization
   * evidence, not proof that the operation later succeeded.
   */
  attestBeforeExecution(payload: PreExecutionAttestationPayloadV1): Promise<PreExecutionAttestationV1>;
}

export interface CapabilitySandboxLease {
  readonly leaseId: string;
  readonly profileDigest: string;
  readonly expiresAtEpochMs: number;
}

export interface CapabilityInvocationContext {
  readonly invocationId: string;
  readonly principalId: string;
  readonly missionId: string;
  readonly runtimeInstanceId: string;
  readonly tokenDigest: string;
  readonly requestDigest: string;
  readonly scope: CapabilityScope;
  readonly budget: CapabilityBudget;
  readonly deadlineEpochMs: number;
  readonly reservation: CapabilityInvocationReservation;
  readonly preExecutionAttestation: PreExecutionAttestationV1;
  readonly authorizationEvidence: CapabilityEvidenceReceipt;
  readonly sandboxLease: CapabilitySandboxLease;
  /** All resource effects must go through this broker; never return raw OS handles. */
  readonly broker: CapabilityResourceBroker;
  readonly abortSignal: AbortSignal;
}

export interface CapabilityResourceBroker {
  perform<T extends string | number | boolean | null | Readonly<Record<string, unknown>> | readonly unknown[]>(
    context: CapabilityInvocationContext,
    request: CapabilityResourceRequest,
  ): Promise<T>;
}

export interface CapabilitySandboxEnforcer {
  /** Creates a least-privilege sandbox before execution. Failure means deny, never fallback. */
  prepare(request: CapabilityInvocationRequest, scope: CapabilityScope, budget: CapabilityBudget): Promise<CapabilitySandboxLease>;
  /** Verifies the lease remains active and all native restrictions are installed immediately before dispatch. */
  assertEnforced(lease: CapabilitySandboxLease, request: CapabilityInvocationRequest): Promise<void>;
  /** Revokes kernel resources/processes and kills the isolated worker on timeout or policy violation. */
  terminate(lease: CapabilitySandboxLease, reasonCode: string): Promise<void>;
}

export interface IsolatedCapabilityExecutor<T> {
  /**
   * Execute inside an isolated worker. Implementations MUST NOT evaluate untrusted
   * agent code in the authority process or hand it ambient process.env/fs/net APIs.
   */
  execute(context: CapabilityInvocationContext): Promise<T>;
}

export interface CapabilityInvocationPipeline {
  /**
   * Normative order: validate signature/audience/time -> check revocation -> atomically
   * reserve quota -> resolve exact scope -> install sandbox -> obtain collector signature
   * -> append authorization evidence to KEL -> assert sandbox -> dispatch isolated code.
   * On any failure, execution MUST NOT start; reservations are finalized and denial evidence
   * is appended where the evidence subsystem is available.
   */
  invoke<T>(request: CapabilityInvocationRequest, executor: IsolatedCapabilityExecutor<T>): Promise<T>;
}

export interface AttenuatedCapabilityBuilder {
  build(rule: AttenuationRule): Promise<CapabilityDelegation>;
}

export interface CapabilityAuthority {
  grant(input: CapabilityGrantRequest): Promise<CapabilityGrant>;
  attenuate(parent: CapabilityToken, rule: AttenuationRule, callerPrincipalId: string): Promise<CapabilityDelegation>;
  revoke(input: CapabilityRevocationRequest): Promise<CapabilityRevocation>;
}

export interface CapabilityGrantRequest {
  readonly issuerPrincipalId: string;
  readonly subjectPrincipalId: string;
  readonly audience: string;
  readonly issuedAtEpochMs: number;
  readonly notBeforeEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly delegation: CapabilityDelegationPolicy;
  readonly scopes: readonly CapabilityScope[];
  readonly budget: CapabilityBudget;
  readonly policyDigest: string;
  readonly reason: string;
  readonly missionId: string;
  readonly runtimeInstanceId: string;
}

export interface CapabilityRevocationRequest {
  readonly token: CapabilityToken;
  readonly revokedByPrincipalId: string;
  readonly reasonCode: string;
  readonly reason: string;
  readonly revokedAtEpochMs: number;
  readonly effectiveAtEpochMs: number;
  readonly policyDigest: string;
  readonly missionId: string;
  readonly runtimeInstanceId: string;
}

/* ------------------------- Canonical cryptographic core ---------------------- */

function canonicalize(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number is not canonicalizable");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("cyclic value is not canonicalizable");
    ancestors.add(value);
    try {
      return "[" + Array.from(value, (entry) => canonicalize(entry, ancestors)).join(",") + "]";
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value !== "object" || value === undefined) throw new TypeError("unsupported canonical value");
  const record = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("only plain objects are canonicalizable");
  if (ancestors.has(record)) throw new TypeError("cyclic value is not canonicalizable");
  ancestors.add(record);
  try {
    const entries = Object.keys(record).sort().map((key) => {
      const entry = record[key];
      if (entry === undefined) throw new TypeError("undefined properties are not canonicalizable");
      return JSON.stringify(key) + ":" + canonicalize(entry, ancestors);
    });
    return "{" + entries.join(",") + "}";
  } finally {
    ancestors.delete(record);
  }
}

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalize(value), "utf8").digest("hex");
}

export function digestCapabilityToken(token: CapabilityToken): string {
  return sha256Hex(token);
}

export function digestCapabilityPayload(payload: unknown): string {
  return sha256Hex(payload);
}

export class Ed25519CapabilitySigner implements CapabilityTokenSigner {
  public constructor(
    public readonly keyId: string,
    private readonly privateKey: KeyObject,
    public readonly principalId: string,
  ) {
    if (!keyId || !principalId || privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
      throw new TypeError("capability signer requires a key ID and an Ed25519 private KeyObject");
    }
  }

  public signPayload(payload: unknown): CapabilitySignatureV1 {
    return Object.freeze({
      algorithm: "Ed25519",
      keyId: this.keyId,
      signatureBase64: sign(null, Buffer.from(canonicalize(payload), "utf8"), this.privateKey).toString("base64"),
    });
  }

  public signToken(payload: CapabilityTokenV1): CapabilityToken {
    validateCapabilityPayload(payload);
    if (payload.issuerPrincipalId !== this.principalId) {
      throw new CapabilitySecurityError("signer_principal_mismatch", "signer key is not registered to the claimed issuer principal");
    }
    return Object.freeze({ payload: deepFreeze(payload), signature: this.signPayload(payload) });
  }
}

export class Ed25519CapabilityTokenVerifier implements CapabilityTokenVerifier {
  public constructor(private readonly keys: CapabilityKeyResolver) {}

  public verify(token: CapabilityToken, expectation: CapabilityVerificationExpectation = {}): void {
    validateCapabilityPayload(token.payload);
    if (token.signature.algorithm !== "Ed25519" || !token.signature.keyId || !token.signature.signatureBase64) {
      throw new CapabilitySecurityError("signature_format_invalid", "capability signature metadata is invalid");
    }
    const key = this.keys.resolvePublicKey(token.signature.keyId);
    const signingPrincipalId = this.keys.resolvePrincipalId(token.signature.keyId);
    if (!key || key.type !== "public" || key.asymmetricKeyType !== "ed25519" ||
        signingPrincipalId !== token.payload.issuerPrincipalId) {
      throw new CapabilitySecurityError("signing_key_untrusted", "capability signing key is not a trusted Ed25519 public key");
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(token.signature.signatureBase64)) {
      throw new CapabilitySecurityError("signature_format_invalid", "capability signature is not valid base64");
    }
    const signature = Buffer.from(token.signature.signatureBase64, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== token.signature.signatureBase64 ||
        !verify(null, Buffer.from(canonicalize(token.payload), "utf8"), key, signature)) {
      throw new CapabilitySecurityError("signature_invalid", "capability token signature verification failed");
    }
    const now = expectation.nowEpochMs ?? Date.now();
    const skew = expectation.maxClockSkewMs ?? 0;
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(skew) || skew < 0) {
      throw new TypeError("verification time and clock skew must be safe integers");
    }
    if (now + skew < token.payload.notBeforeEpochMs) {
      throw new CapabilitySecurityError("token_not_yet_valid", "capability is not active yet");
    }
    if (now - skew >= token.payload.expiresAtEpochMs) {
      throw new CapabilitySecurityError("token_expired", "capability has expired");
    }
    if (expectation.subjectPrincipalId && expectation.subjectPrincipalId !== token.payload.subjectPrincipalId) {
      throw new CapabilitySecurityError("subject_mismatch", "capability subject does not match the caller");
    }
    if (expectation.audience && expectation.audience !== token.payload.audience) {
      throw new CapabilitySecurityError("audience_mismatch", "capability audience does not match this runtime");
    }
  }
}

export interface PreExecutionAttestationExpectation {
  readonly nowEpochMs?: number;
  readonly invocationId?: string;
  readonly tokenDigest?: string;
  readonly requestDigest?: string;
  readonly runtimeInstanceId?: string;
}

export function verifyPreExecutionAttestation(
  attestation: PreExecutionAttestationV1,
  keys: CapabilityKeyResolver,
  expectation: PreExecutionAttestationExpectation = {},
): void {
  const payload = attestation?.payload;
  if (!payload || payload.schema !== CAPABILITY_ATTESTATION_SCHEMA) {
    throw new CapabilitySecurityError("attestation_schema_invalid", "pre-execution attestation schema is invalid");
  }
  for (const [field, value] of [
    ["invocationId", payload.invocationId],
    ["tokenId", payload.tokenId],
    ["principalId", payload.principalId],
    ["missionId", payload.missionId],
    ["runtimeInstanceId", payload.runtimeInstanceId],
    ["audience", payload.audience],
    ["reservationId", payload.reservationId],
  ] as const) validId(value, "attestation." + field);
  for (const [field, value] of [
    ["tokenDigest", payload.tokenDigest],
    ["requestDigest", payload.requestDigest],
    ["scopeDigest", payload.scopeDigest],
    ["policyDigest", payload.policyDigest],
    ["sandboxProfileDigest", payload.sandboxProfileDigest],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new CapabilitySecurityError("attestation_schema_invalid", "attestation." + field + " must be SHA-256 hex");
    }
  }
  assertSafeInteger(payload.issuedAtEpochMs, "attestation.issuedAtEpochMs");
  assertSafeInteger(payload.expiresAtEpochMs, "attestation.expiresAtEpochMs", 1);
  if (payload.expiresAtEpochMs <= payload.issuedAtEpochMs) {
    throw new CapabilitySecurityError("attestation_time_invalid", "attestation time bounds are inconsistent");
  }
  const signature = attestation.signature;
  if (!signature || signature.algorithm !== "Ed25519" || !signature.keyId ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature.signatureBase64)) {
    throw new CapabilitySecurityError("attestation_signature_invalid", "attestation signature metadata is malformed");
  }
  const key = keys.resolvePublicKey(signature.keyId);
  const signatureBytes = Buffer.from(signature.signatureBase64, "base64");
  if (!key || key.type !== "public" || key.asymmetricKeyType !== "ed25519" ||
      signatureBytes.length !== 64 || signatureBytes.toString("base64") !== signature.signatureBase64 ||
      !verify(null, Buffer.from(canonicalize(payload), "utf8"), key, signatureBytes)) {
    throw new CapabilitySecurityError("attestation_signature_invalid", "runtime attestation signature is not trusted");
  }
  const now = expectation.nowEpochMs ?? Date.now();
  if (!Number.isSafeInteger(now) || now < payload.issuedAtEpochMs || now >= payload.expiresAtEpochMs) {
    throw new CapabilitySecurityError("attestation_expired", "pre-execution attestation is not currently valid");
  }
  if ((expectation.invocationId && expectation.invocationId !== payload.invocationId) ||
      (expectation.tokenDigest && expectation.tokenDigest !== payload.tokenDigest) ||
      (expectation.requestDigest && expectation.requestDigest !== payload.requestDigest) ||
      (expectation.runtimeInstanceId && expectation.runtimeInstanceId !== payload.runtimeInstanceId)) {
    throw new CapabilitySecurityError("attestation_binding_mismatch", "runtime attestation does not bind the expected invocation");
  }
}

export class CapabilitySecurityError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CapabilitySecurityError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function validId(value: string, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new CapabilitySecurityError("token_schema_invalid", field + " must be a non-empty canonical identifier");
  }
}

function assertSafeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CapabilitySecurityError("token_schema_invalid", field + " must be a safe integer >= " + minimum);
  }
}

function assertUniqueStrings(values: readonly string[], field: string, validateId = true): void {
  if (!Array.isArray(values) || values.length === 0) throw new CapabilitySecurityError("scope_invalid", field + " must not be empty");
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || value.includes("*") || value.includes("\0")) {
      throw new CapabilitySecurityError("scope_invalid", field + " contains an empty or wildcard value");
    }
    if (validateId) validId(value, field);
    if (seen.has(value)) throw new CapabilitySecurityError("scope_invalid", field + " contains duplicates");
    seen.add(value);
  }
}

function assertOperations(operations: readonly string[], allowed: readonly string[]): void {
  assertUniqueStrings(operations, "operations");
  for (const operation of operations) {
    if (!allowed.includes(operation)) throw new CapabilitySecurityError("scope_invalid", "operation is not valid for this resource kind");
  }
}

function validateRelativePathPrefix(path: string): void {
  if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new CapabilitySecurityError("scope_invalid", "filesystem path must be a canonical relative path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw new CapabilitySecurityError("scope_invalid", "filesystem path traversal segments are forbidden");
  }
}

function validateBudget(b: CapabilityBudget): void {
  const fields: readonly (keyof CapabilityBudget)[] = [
    "maxInvocations", "maxConcurrentInvocations", "maxWallClockMsPerInvocation",
    "maxCpuMsPerInvocation", "maxMemoryBytes", "maxNetworkBytes", "maxOutputBytes",
    "maxProcesses", "maxFinancialSpendMinorUnits",
  ];
  for (const field of fields) assertSafeInteger(b[field], "budget." + field);
  if (b.maxInvocations < 1 || b.maxConcurrentInvocations < 1 || b.maxConcurrentInvocations > b.maxInvocations) {
    throw new CapabilitySecurityError("budget_invalid", "invocation quotas must be positive and concurrent quota cannot exceed total quota");
  }
}

export function validateCapabilityScope(scope: CapabilityScope): void {
  validId(scope.handleId, "scope.handleId");
  validId(scope.resourceId, "scope.resourceId");
  assertOperations(scope.operations, operationsForKind(scope.kind));
  switch (scope.kind) {
    case "filesystem":
      validateRelativePathPrefix(scope.relativePathPrefix);
      assertSafeInteger(scope.maxBytesPerInvocation, "scope.maxBytesPerInvocation");
      break;
    case "network":
      assertUniqueStrings(scope.hosts, "scope.hosts", false);
      for (const host of scope.hosts) {
        const labels = host.split(".");
        const validDnsName = host.length <= 253 && labels.every((label) =>
          label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
        if (host !== host.toLowerCase() || host.endsWith(".") ||
            (isIP(host) === 0 && !validDnsName)) {
          throw new CapabilitySecurityError("scope_invalid", "network hosts must be normalized exact DNS names or IP literals");
        }
      }
      if (!Array.isArray(scope.ports) || scope.ports.length === 0) throw new CapabilitySecurityError("scope_invalid", "network ports must be explicit");
      for (const range of scope.ports) {
        assertSafeInteger(range.first, "scope.ports.first", 1);
        assertSafeInteger(range.last, "scope.ports.last", 1);
        if (range.last < range.first || range.last > 65535) throw new CapabilitySecurityError("scope_invalid", "network port range is invalid");
      }
      assertSafeInteger(scope.maxBytesPerInvocation, "scope.maxBytesPerInvocation");
      break;
    case "process":
      assertUniqueStrings(scope.executableSha256, "scope.executableSha256", false);
      if (scope.executableSha256.some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
        throw new CapabilitySecurityError("scope_invalid", "executable digests must be lower-case SHA-256 hex");
      }
      if (!Array.isArray(scope.argvPrefixes) || scope.argvPrefixes.length === 0) {
        throw new CapabilitySecurityError("scope_invalid", "process argv prefixes must be explicit");
      }
      for (const argv of scope.argvPrefixes) {
        if (!Array.isArray(argv) || argv.length === 0 || argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
          throw new CapabilitySecurityError("scope_invalid", "argv prefixes must contain only strings without NUL");
        }
      }
      assertUniqueStrings(scope.environmentKeys, "scope.environmentKeys", false);
      assertSafeInteger(scope.maxProcesses, "scope.maxProcesses");
      break;
    case "memory":
      assertUniqueStrings(scope.regionIds, "scope.regionIds");
      assertSafeInteger(scope.maxBytesPerInvocation, "scope.maxBytesPerInvocation");
      break;
    case "ipc":
      assertUniqueStrings(scope.channelIds, "scope.channelIds");
      assertUniqueStrings(scope.peerPrincipalIds, "scope.peerPrincipalIds");
      assertSafeInteger(scope.maxMessageBytes, "scope.maxMessageBytes");
      break;
    default: {
      const exhaustive: never = scope;
      throw new CapabilitySecurityError("scope_invalid", "unsupported scope: " + String(exhaustive));
    }
  }
}

function operationsForKind(kind: CapabilityResourceKind): readonly CapabilityOperation[] {
  switch (kind) {
    case "filesystem": return ["fs.read", "fs.list", "fs.metadata", "fs.write", "fs.create", "fs.delete"];
    case "network": return ["net.resolve", "net.connect", "net.send", "net.receive"];
    case "process": return ["process.spawn", "process.inspect", "process.signal", "process.terminate"];
    case "memory": return ["memory.read", "memory.write"];
    case "ipc": return ["ipc.send", "ipc.receive"];
  }
}

export function validateCapabilityPayload(payload: CapabilityTokenV1): void {
  if (!payload || payload.schema !== CAPABILITY_TOKEN_SCHEMA) throw new CapabilitySecurityError("token_schema_invalid", "unsupported capability token schema");
  validId(payload.tokenId, "tokenId");
  validId(payload.issuerPrincipalId, "issuerPrincipalId");
  validId(payload.subjectPrincipalId, "subjectPrincipalId");
  validId(payload.audience, "audience");
  validId(payload.nonce, "nonce");
  validId(payload.policyDigest, "policyDigest");
  assertSafeInteger(payload.issuedAtEpochMs, "issuedAtEpochMs");
  assertSafeInteger(payload.notBeforeEpochMs, "notBeforeEpochMs");
  assertSafeInteger(payload.expiresAtEpochMs, "expiresAtEpochMs", 1);
  assertSafeInteger(payload.delegationDepth, "delegationDepth");
  if (payload.expiresAtEpochMs <= payload.issuedAtEpochMs ||
      payload.notBeforeEpochMs < payload.issuedAtEpochMs ||
      payload.notBeforeEpochMs >= payload.expiresAtEpochMs) {
    throw new CapabilitySecurityError("token_schema_invalid", "capability time bounds are inconsistent");
  }
  if (payload.parentTokenDigest !== null && !/^[a-f0-9]{64}$/.test(payload.parentTokenDigest)) {
    throw new CapabilitySecurityError("token_schema_invalid", "parent token digest must be SHA-256 hex or null");
  }
  if ((payload.parentTokenDigest === null) !== (payload.delegationDepth === 0)) {
    throw new CapabilitySecurityError("token_schema_invalid", "root tokens must have depth zero and delegated tokens must name a parent digest");
  }
  if (!payload.delegation || typeof payload.delegation.enabled !== "boolean") throw new CapabilitySecurityError("delegation_invalid", "delegation policy is missing");
  assertSafeInteger(payload.delegation.maxDepth, "delegation.maxDepth");
  if (payload.delegation.maxDepth < payload.delegationDepth) throw new CapabilitySecurityError("delegation_invalid", "delegation depth exceeds policy");
  if (payload.delegation.enabled && payload.delegation.maxDepth <= payload.delegationDepth) {
    throw new CapabilitySecurityError("delegation_invalid", "enabled delegation must permit a deeper child");
  }
  if (!payload.delegation.enabled && payload.delegation.allowedDelegatePrincipalIds.length !== 0) {
    throw new CapabilitySecurityError("delegation_invalid", "disabled delegation must have an empty delegate allowlist");
  }
  if (payload.delegation.enabled) assertUniqueStrings(payload.delegation.allowedDelegatePrincipalIds, "delegation.allowedDelegatePrincipalIds");
  if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) throw new CapabilitySecurityError("scope_invalid", "capability must contain at least one scope");
  for (const scope of payload.scopes) validateCapabilityScope(scope);
  validateBudget(payload.budget);
}

function subsetOf<T>(child: readonly T[], parent: readonly T[]): boolean {
  return child.every((item) => parent.includes(item));
}

function isPathWithin(parent: string, child: string): boolean {
  return parent === "" || child === parent || child.startsWith(parent.endsWith("/") ? parent : parent + "/");
}

function portRangeSubset(child: PortRange, parent: PortRange): boolean {
  return child.first >= parent.first && child.last <= parent.last;
}

function stringPrefix(parent: readonly string[], child: readonly string[]): boolean {
  return parent.length <= child.length && parent.every((value, index) => value === child[index]);
}

export function isScopeAttenuation(child: CapabilityScope, parent: CapabilityScope): boolean {
  if (child.kind !== parent.kind || child.handleId !== parent.handleId || child.resourceId !== parent.resourceId) return false;
  if (!subsetOf(child.operations, parent.operations)) return false;
  switch (child.kind) {
    case "filesystem": {
      if (parent.kind !== "filesystem") return false;
      return isPathWithin(parent.relativePathPrefix, child.relativePathPrefix) &&
        child.maxBytesPerInvocation <= parent.maxBytesPerInvocation;
    }
    case "network": {
      if (parent.kind !== "network") return false;
      return subsetOf(child.hosts, parent.hosts) &&
        child.ports.every((childPort) => parent.ports.some((parentPort) => portRangeSubset(childPort, parentPort))) &&
        child.maxBytesPerInvocation <= parent.maxBytesPerInvocation;
    }
    case "process": {
      if (parent.kind !== "process") return false;
      return subsetOf(child.executableSha256, parent.executableSha256) &&
        child.argvPrefixes.every((childPrefix) => parent.argvPrefixes.some((parentPrefix) => stringPrefix(parentPrefix, childPrefix))) &&
        subsetOf(child.environmentKeys, parent.environmentKeys) &&
        child.maxProcesses <= parent.maxProcesses;
    }
    case "memory": {
      if (parent.kind !== "memory") return false;
      return subsetOf(child.regionIds, parent.regionIds) && child.maxBytesPerInvocation <= parent.maxBytesPerInvocation;
    }
    case "ipc": {
      if (parent.kind !== "ipc") return false;
      return subsetOf(child.channelIds, parent.channelIds) && subsetOf(child.peerPrincipalIds, parent.peerPrincipalIds) &&
        child.maxMessageBytes <= parent.maxMessageBytes;
    }
  }
}

export function isBudgetAttenuation(child: CapabilityBudget, parent: CapabilityBudget): boolean {
  const fields: readonly (keyof CapabilityBudget)[] = [
    "maxInvocations", "maxConcurrentInvocations", "maxWallClockMsPerInvocation",
    "maxCpuMsPerInvocation", "maxMemoryBytes", "maxNetworkBytes", "maxOutputBytes",
    "maxProcesses", "maxFinancialSpendMinorUnits",
  ];
  return fields.every((field) => child[field] <= parent[field]);
}

export class AttenuatedCapabilityBuilderV1 implements AttenuatedCapabilityBuilder {
  public constructor(
    private readonly parent: CapabilityToken,
    private readonly callerPrincipalId: string,
    private readonly verifier: CapabilityTokenVerifier,
    private readonly signer: Ed25519CapabilitySigner,
    private readonly evidence: CapabilityEvidenceSink,
    private readonly revocations: CapabilityRevocationRegistry,
    private readonly now: () => number = Date.now,
    private readonly makeId: () => string = () => randomUUID(),
  ) {}

  public async build(rule: AttenuationRule): Promise<CapabilityDelegation> {
    const now = this.now();
    validId(rule.missionId, "missionId");
    validId(rule.runtimeInstanceId, "runtimeInstanceId");
    validId(rule.policyDigest, "policyDigest");
    this.verifier.verify(this.parent, { nowEpochMs: now, subjectPrincipalId: this.callerPrincipalId });
    const parentDigest = digestCapabilityToken(this.parent);
    if (await this.revocations.isRevoked(this.parent.payload.tokenId, parentDigest, now)) {
      throw new CapabilitySecurityError("capability_revoked", "parent capability or an ancestor has been revoked");
    }
    const parent = this.parent.payload;
    if (this.signer.keyId !== this.parent.signature.keyId ||
        this.signer.principalId !== parent.issuerPrincipalId) {
      throw new CapabilitySecurityError("delegation_signer_mismatch", "attenuation must use the trusted signer bound to the parent issuer");
    }
    if (!parent.delegation.enabled || parent.delegationDepth >= parent.delegation.maxDepth) {
      throw new CapabilitySecurityError("delegation_forbidden", "parent capability cannot be delegated further");
    }
    if (!parent.delegation.allowedDelegatePrincipalIds.includes(rule.subjectPrincipalId)) {
      throw new CapabilitySecurityError("delegate_not_allowed", "recipient principal is not authorized by the parent delegation policy");
    }
    if (!rule.reason.trim()) throw new CapabilitySecurityError("attenuation_reason_required", "delegation reason is required");
    if (!rule.scopes.length || !rule.scopes.every((child) => {
      validateCapabilityScope(child);
      return parent.scopes.some((allowed) => isScopeAttenuation(child, allowed));
    })) {
      throw new CapabilitySecurityError("scope_escalation", "child scopes must be strict subsets of parent scopes");
    }
    validateBudget(rule.budget);
    if (!isBudgetAttenuation(rule.budget, parent.budget)) {
      throw new CapabilitySecurityError("budget_escalation", "child budget cannot exceed parent budget");
    }
    if (!Number.isSafeInteger(rule.expiresAtEpochMs) ||
        rule.expiresAtEpochMs <= now || rule.expiresAtEpochMs > parent.expiresAtEpochMs) {
      throw new CapabilitySecurityError("expiry_escalation", "child expiry must be in the future and no later than parent expiry");
    }
    assertSafeInteger(rule.delegation.maxDepth, "delegation.maxDepth");
    if (rule.delegation.enabled) {
      if (rule.delegation.maxDepth <= parent.delegationDepth + 1 ||
          rule.delegation.maxDepth > parent.delegation.maxDepth ||
          !subsetOf(rule.delegation.allowedDelegatePrincipalIds, parent.delegation.allowedDelegatePrincipalIds)) {
        throw new CapabilitySecurityError("delegation_escalation", "child delegation policy exceeds the parent's policy");
      }
      assertUniqueStrings(rule.delegation.allowedDelegatePrincipalIds, "delegation.allowedDelegatePrincipalIds");
    } else if (rule.delegation.maxDepth < parent.delegationDepth + 1 || rule.delegation.allowedDelegatePrincipalIds.length !== 0) {
      throw new CapabilitySecurityError("delegation_invalid", "disabled child delegation must have no delegate allowlist");
    }

    const childPayload: CapabilityTokenV1 = deepFreeze({
      schema: CAPABILITY_TOKEN_SCHEMA,
      tokenId: this.makeId(),
      issuerPrincipalId: parent.issuerPrincipalId,
      subjectPrincipalId: rule.subjectPrincipalId,
      audience: parent.audience,
      nonce: this.makeId(),
      issuedAtEpochMs: now,
      notBeforeEpochMs: now,
      expiresAtEpochMs: rule.expiresAtEpochMs,
      parentTokenDigest: parentDigest,
      delegationDepth: parent.delegationDepth + 1,
      delegation: rule.delegation,
      scopes: rule.scopes,
      budget: rule.budget,
      policyDigest: rule.policyDigest,
    });
    const childToken = this.signer.signToken(childPayload);
    const evidenceReceipt = await this.evidence.append(Object.freeze({
      schema: CAPABILITY_EVIDENCE_SCHEMA,
      eventId: this.makeId(),
      kind: "capability-attenuated",
      occurredAtEpochMs: now,
      principalId: this.callerPrincipalId,
      missionId: rule.missionId,
      runtimeInstanceId: rule.runtimeInstanceId,
      tokenId: childPayload.tokenId,
      tokenDigest: digestCapabilityToken(childToken),
      parentTokenDigest: childPayload.parentTokenDigest,
      invocationId: null,
      requestDigest: null,
      policyDigest: rule.policyDigest,
      outcome: "allowed",
      reasonCode: "attenuation_accepted",
      details: Object.freeze({
        parentTokenId: parent.tokenId,
        childSubjectPrincipalId: childPayload.subjectPrincipalId,
        delegationDepth: childPayload.delegationDepth,
        reason: rule.reason,
      }),
    }));
    return Object.freeze({
      parentTokenDigest: childPayload.parentTokenDigest!,
      childToken,
      delegatedByPrincipalId: this.callerPrincipalId,
      delegatedToPrincipalId: rule.subjectPrincipalId,
      createdAtEpochMs: now,
      kelEvidenceId: evidenceReceipt.evidenceId,
      kelStatementDigest: evidenceReceipt.statementDigest,
    });
  }
}
