# Phase 3 — `@klyn/governance` Integration Plan

## Security boundary

`@klyn/governance` is a backend/infrastructure-only subsystem. It has no dependency on frontend, UI, React, Next.js, browser APIs, or presentation state. Its only runtime dependency is Node.js cryptography (`node:crypto`).

The subsystem sits between intent/planning and privileged execution:

`intent/objective → governance authorization → tool execution → evidence capture → completion gate → artifact attestation → audit ledger`

The authoritative rule is fail-closed: absence of an explicit valid scope or valid verification evidence never grants permission or completion.

## Integration points

### 1. `@klyn/ai-engine`

The router remains responsible for model/provider selection. Governance must receive a normalized execution request before any model/tool adapter is allowed to perform a privileged operation. Provider selection itself does not grant tool permission.

Required adapter boundary:

```ts
const decision = governance.authorize(executionRequest, activeScopes);
if (!decision.allowed) throw new Error(`governance denied: ${decision.reason}`);
```

### 2. Execution/runtime subsystems

Every privileged filesystem, network, database, secret, deployment, or other tool invocation should be represented as a `ToolExecutionRequest` and authorized immediately before execution. Do not cache an allow decision across scope expiry or principal/session changes.

### 3. Evidence collection

Test runners, static analyzers, runtime observers, and external verifiers write `EvidenceRecord` entries. Each record must reference the objective and one or more explicit verification invariants. Evidence is never inferred from a successful tool call.

### 4. Completion/finalization

Only `CompletionGate.evaluate()` can establish objective completion. Each required invariant must have at least one independently marked `verified` evidence record. A model response, log line, or test process exit code by itself is not a completion proof unless it is captured as evidence for a declared invariant.

### 5. Artifact release

Artifact promotion should require `GovernanceEngine.attestArtifact()`. Attestation recomputes completion from the current evidence ledger, binds the result to the pre-attestation audit head, hashes the attestation payload, and signs it with Ed25519.

### 6. Persistent storage

Phase 3 currently exposes deterministic in-memory ledgers behind narrow interfaces/classes. Production wiring should persist:

- audit records in an append-only store;
- evidence records keyed by `evidenceId` and `objectiveId`;
- policy/scope versions with explicit validity windows;
- artifact attestations and trusted public keys.

The persistence layer must preserve insertion order and reject duplicate sequence/hash-chain positions.

## Zero-trust rules

1. Default deny.
2. Principal, session, tool, operation, risk, resource, network origin, expiry, and policy version are explicit authorization inputs.
3. Wildcard scope selectors are rejected at the runtime boundary.
4. Authorization decisions are written to the audit ledger.
5. Completion requires verified evidence for every required invariant.
6. Artifact attestation recomputes completion instead of trusting caller-supplied completion state.
7. The audit ledger is hash-linked; each record commits to the previous record hash.
8. Artifact attestations are signed with Ed25519 and include the audit head and evidence digest.

## Rollout sequence

1. Add `@klyn/governance` to the backend workspace.
2. Make the tool executor call `authorize()` at the final privilege boundary.
3. Emit evidence from CI/test/runtime verifiers using stable invariant IDs.
4. Replace informal "done/success" flags with `CompletionDecision.complete`.
5. Require `attestArtifact()` before durable artifact promotion.
6. Move audit/evidence storage from in-memory implementations to the production append-only store.
7. Add key rotation and trusted-key distribution without weakening signature verification.

No frontend integration is part of Phase 3.

## Verification gates

The Phase 3 test suite covers malformed-input fail-closed behavior, deny-by-default authorization, explicit scope matching, resource boundary enforcement, risk/expiry checks, wildcard rejection, evidence completeness, rejected-evidence behavior, completion recomputation, Ed25519 signature verification, tamper detection, and audit-chain integrity.
