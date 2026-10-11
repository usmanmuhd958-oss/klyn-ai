# KLYN OS Object-Capability (OCap) v1

## Status and scope

This document specifies the signed capability format and the runtime contracts in
`packages/autonomy/src/capability.ts`. The module implements Ed25519 token signing
and verification, scope/budget attenuation checks, and a fail-closed child-token
builder. It is **not**, by itself, an operating-system sandbox. A deployment is
not production-qualified until its native resource broker, durable quota/revocation
stores, runtime collector, KEL adapter, and adversarial tests satisfy the contracts
below.

## Security model

The trusted computing base is deliberately small: capability issuer/signing
service; public-key and policy registry; durable invocation/revocation store; KEL
evidence adapter; execution-runtime collector; native resource broker; and the
sandbox supervisor. Agents, prompts, plans, tool arguments, tool output, and
delegated workloads are untrusted.

The protocol follows deny-by-default rules:

1. A capability names one principal, one audience, expiry and activation bounds,
   a policy digest, finite resource scopes, and explicit operation sets.
2. Tokens carry opaque broker handle IDs, not absolute paths, file descriptors,
   socket objects, process IDs, environment snapshots, or private key material.
   A handle is useful only when the trusted broker maps it to a resource and binds
   it to the caller, scope, audience, and sandbox lease.
3. Signatures are Ed25519 over the deterministic JSON encoding of the entire token
   payload. The signed payload includes the parent-token digest, so changes to a
   scope, subject, budget, time bound, policy version, or delegation chain invalidate
   the signature. Public keys are resolved by configured key ID; a key supplied by
   the token itself is never trusted.
4. Attenuation may remove operations, shrink resource scope, decrease quotas, shorten
   expiry, or disable delegation. It cannot change the resource handle, add an
   operation, widen a path/host/channel/peer/argv boundary, increase any budget, or
   delegate to a principal outside the parent token's explicit allowlist.
5. Quota reservation and revocation checks must be linearizable across runtime
   workers. A local in-memory counter is unsuitable for production multi-worker
   deployments. Failed admission consumes quota unless an audited policy explicitly
   refunds the reservation.
6. A runtime collector signs a *pre-execution authorization attestation* after policy
   checks and sandbox preparation and before dispatch. That attestation proves the
   runtime approved a specific token digest, request digest, sandbox profile, and
   quota reservation; it does not assert that the operation later succeeded.
7. The signed decision and its scope/policy/token digests are appended to KEL before
   untrusted execution begins. Completion/failure is a distinct later event. If KEL
   append, attestation verification, revocation lookup, quota reservation, or sandbox
   installation fails, execution must not begin.

## Capability scope model

Each `CapabilityScope` represents one resource kind and one broker handle:

- **Filesystem** — a root handle plus canonical relative subtree, explicit
  read/list/metadata/write/create/delete operations and a byte ceiling. The native
  broker must resolve paths beneath an already-opened root (for example, using
  `openat2` with beneath/no-magic-link constraints on Linux), reject symlink and
  TOCTOU escapes, and apply the policy to every open and mutation.
- **Network** — explicit hosts and port ranges; there is no wildcard or implicit
  internet capability. The network broker should resolve and pin allowed addresses,
  enforce redirect policy, reject DNS rebinding to forbidden ranges, and block
  loopback/link-local/cloud metadata endpoints unless separately granted.
- **Process** — executable content digests, non-empty argv prefixes, named
  environment keys and a process ceiling. Spawn uses an approved absolute binary
  handle, never a shell string; environment values are broker-generated/validated,
  and namespace/cgroup/seccomp controls remain mandatory.
- **Memory** — explicit registered region IDs and read/write operations, with
  maximum bytes per invocation. Region IDs must be resolved by the runtime and
  checked for bounds on every access.
- **IPC** — explicit channel IDs and peer principal IDs, plus a message-size limit.
  The IPC broker authenticates the peer and does not trust caller-supplied identity.

Scope IDs must be registered and owned by the trusted broker. An agent cannot
create a useful capability by inventing a syntactically valid handle ID.

## Token and evidence lifecycle

### Grant

1. Policy evaluation computes the exact scopes, budgets, subject, audience, expiry,
   delegation allowlist, and policy digest.
2. The issuer validates those values and signs a new `CapabilityToken` using an
   Ed25519 key whose private material remains in the signer service/HSM/KMS.
3. A grant evidence event is written to KEL before the token is released to the
   subject. The returned `CapabilityGrant` records the committed evidence ID and
   digest.

### Delegation / attenuation

The child token uses the parent subject as the delegating principal, references the
digest of the complete parent token including its signature, increments delegation
depth, preserves audience, and narrows time, scopes, budgets, and delegation rights.
`AttenuatedCapabilityBuilderV1` refuses to return the child until the attenuation
event is durably appended through `CapabilityEvidenceSink`. The sink must adapt this
event to the existing KEL v1 `EvidenceStatementV1`; it must not invent a separate
unverifiable log format. The adapter should use the KEL `authorization-decision`
kind and carry event schema, token/parent digests, mission/runtime IDs, decision,
policy digest, and request digest in the structured evidence/extensions fields.

### Revocation

Revocation is a signed, durable, auditable state transition keyed by token ID and
token digest. The runtime checks the registry on every invocation; cached revocation
data is not sufficient for high-risk capabilities unless it has a bounded and
documented staleness policy. Revocations are fail-closed if the registry is
unavailable. Revoking a parent should, by policy, also block descendants by walking
the signed parent-digest chain or maintaining a durable descendant index.

### Invocation

The production pipeline order is normative:

`verify token signature -> check subject/audience/time -> check token/ancestor
revocation -> atomically reserve total/concurrent quota -> match exact scope and
requested operation -> prepare sandbox -> collector signs pre-execution attestation
-> append KEL authorization evidence -> revalidate sandbox lease -> dispatch isolated
worker -> enforce runtime/cpu/memory/network/output limits -> append completion or
failure evidence -> finalize reservation`.

The execution worker receives only a mediated broker context and the minimum
capability it needs. The authority process must never pass its signing key, unrestricted
filesystem/network clients, ambient credentials, or raw OS handles to the agent.

## Required deployment adapters

- `CapabilityEvidenceSink`: transactionally append a standard KEL v1 evidence
  statement and return only after durable ledger acceptance.
- `CapabilityRevocationRegistry`: durable, multi-worker consistent state keyed by
  token ID and digest; fail closed on read/write errors.
- `CapabilityInvocationCounter`: atomic admission reservation that enforces total
  and concurrent quotas under races and idempotent finalization.
- `ExecutionRuntimeCollector`: sign pre-execution statements with a runtime-controlled
  Ed25519 key; the collector's public key is independently pinned/rotated.
- `CapabilitySandboxEnforcer`: create and verify enforcement, terminate all worker
  resources on cancellation/timeout, and never fall back to unsandboxed execution.
- `CapabilityResourceBroker`: resolve resource handles only from the trusted registry,
  intersect token scope with policy, and check every resource operation.
- A native supervisor: namespaces and seccomp where applicable, cgroups v2/rlimits,
  restricted mounts, no inherited descriptors, minimal environment, network policy,
  bounded IPC, and process-tree cleanup.

## Threat analysis and limits

| Threat | Required mitigation | What this does not prove alone |
|---|---|---|
| Ambient authority leakage | No global tools in agent API; broker handles only; isolated execution with no inherited descriptors or credentials | TypeScript types cannot stop code running in the same process from calling Node.js APIs |
| Prompt injection | Treat prompt/tool output as data; authorize every proposed action against signed scope and independent policy; use exact handles and operation checks | Prompt filtering cannot replace capability enforcement; injection can still cause harmful actions within an over-broad grant |
| Resource exhaustion / side channels | Atomic quotas, concurrent admission, CPU/memory/network/output ceilings, wall-clock deadline, queue limits, kill-on-budget-exceeded, per-tenant isolation | Per-invocation checks do not prove system-wide fairness; scheduler, kernel limits, shared-cache behavior and load tests matter |
| Unauthorized multi-agent execution | Subject binding, audience binding, explicit delegate allowlist, depth bound, signed parent digest, revocation ancestry checks, per-agent invocation quotas | A copied bearer token can be replayed by whoever obtains it unless subject proof-of-possession or a runtime-bound non-exportable handle is added |
| Forged audit claims | Runtime collector signature before dispatch and KEL durability before dispatch; later outcome event is separate | A compromised runtime/collector key or compromised host can lie; independent witness/anchor and key custody are needed |
| Rollback / split view | KEL checkpoints/witness quorum and external checkpoint anchoring | A local Merkle ledger alone cannot stop privileged rollback or equivocation |

## Protocol rules

- Unknown schema versions, key IDs, resource kinds, operations, fields with invalid
  values, expired tokens, future tokens, mismatched subject/audience, revoked token
  ancestry, quota-store failures, sandbox failures, and KEL write failures are hard
  denials.
- No wildcard operations, wildcard hosts, glob paths, shell expansion, ambient
  filesystem roots, default network access, arbitrary environment pass-through, or
  caller-selected public keys.
- Every delegation and invocation references a digest of the exact signed token.
  Request arguments are hashed before evidence creation; sensitive values are not
  copied into KEL payloads.
- The signature/key lifecycle, clock synchronization, revocation consistency,
  sandbox policy digest, runtime collector key rotation and KEL checkpoint anchoring
  are operational controls and must be tested in the deployment environment.
- Unit tests for token verification and attenuation are necessary but insufficient.
  Release qualification additionally requires fuzzing of token/JSON parsers, property
  tests proving child scope/budget subsets, concurrent quota/revocation race tests,
  adversarial symlink/DNS/process/IPC tests, crash-recovery tests, and an independent
  security review.
