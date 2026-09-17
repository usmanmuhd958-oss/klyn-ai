# Phase 5 — `@klyn/mission-engine` Integration Plan

## Purpose

`@klyn/mission-engine` is the final deterministic control plane for mission completion. It converts a declared mission graph plus cryptographically valid evidence into an append-only, replayable state transition sequence.

The engine deliberately separates:

- **Test Passed** — execution/test evidence establishes that a specified test condition passed for a specific artifact.
- **Requirement Verified** — a distinct, cryptographically validated requirement proof establishes that the mission requirement invariant attached to the graph has been satisfied.
- **Deployment Confirmed** — deployment evidence establishes that the verified artifact was actually deployed and attested.

A test result can never advance the machine directly from `TEST_PASSED` to `DEPLOYMENT_CONFIRMED` or silently satisfy a requirement invariant.

## Runtime position

```text
Intent / Objective
        |
        v
Verifiable Mission Graph
        |
        v
@klyn/mission-engine
  parse + graph digest verification
  deterministic transition validation
  cryptographic evidence verification
  artifact/evidence chain binding
  state snapshot + replay
        |
        +----------------------+
        |                      |
        v                      v
@klyn/runtime             @klyn/governance
hardware execution        authorization + evidence policy
        |                      |
        +----------+-----------+
                   |
                   v
          execution/evidence log
                   |
                   v
             deployment system
```

## Canonical transition contract

The mission graph contains exactly five ordered states:

`ACTION_EXECUTED -> ARTIFACT_PRODUCED -> TEST_PASSED -> REQUIREMENT_VERIFIED -> DEPLOYMENT_CONFIRMED`

The graph is SHA-256 addressed. Each transition must satisfy all of the following:

1. The mission and objective identity match the graph.
2. The evidence targets the exact next node and expected evidence kind.
3. The evidence verifier identity matches the configured Ed25519 verifier.
4. The evidence is not future-dated.
5. The evidence payload digest is correct and its Ed25519 signature verifies.
6. Predecessor evidence binding is exact and deterministic.
7. Artifact-bound stages carry the exact produced artifact digest.
8. Requirement proof covers the exact invariants declared by the `REQUIREMENT_VERIFIED` node.
9. Deployment confirmation references the accepted requirement proof and the exact verified artifact digest.

Any failed validation moves the engine into a fail-closed blocked state and no partial transition is committed.

## Evidence handoff

### From `@klyn/runtime`

The runtime emits execution observations and verified execution results. Those results are evidence inputs, not objective-level proof. Runtime output should be wrapped by a mission-engine evidence adapter containing:

- mission ID
- objective ID
- target node ID
- execution artifact digest
- predecessor evidence ID
- verifier identity
- canonical payload digest
- Ed25519 signature

### From `@klyn/governance`

Governance remains the trust-policy authority for principal/session/tool/resource authorization and evidence policy. The mission engine consumes a narrow `EvidenceVerifier` interface so it can validate signatures without importing frontend code or binding itself to a storage implementation.

A production adapter may map Phase 3 evidence records and artifact attestations into mission evidence. The adapter must preserve the cryptographic identity of the original payload rather than copying caller-supplied completion flags.

## Replay and audit

Mission state is derivable from the ordered evidence log. `MissionStateMachine.replay(...)` reconstructs the state machine from the accepted evidence sequence and therefore supports:

- crash recovery
- deterministic audit replay
- forensic verification
- cross-node state reconstruction
- regression tests against historical evidence logs

The evidence log should be persisted append-only by the production integration layer. The mission engine itself remains storage-agnostic.

## Integration sequence

1. Register `@klyn/mission-engine` in the root workspace only after the package certification workflow is green.
2. Add a mission graph adapter from the objective/intent layer.
3. Add a runtime evidence adapter from `@klyn/runtime`.
4. Add a governance evidence verifier adapter using the Phase 3 cryptographic trust boundary.
5. Persist accepted mission evidence in the existing append-only evidence/audit store.
6. Add deployment confirmation adapters for the approved deployment providers.
7. Promote only `DEPLOYMENT_CONFIRMED` missions to the higher-level completion/reporting layer.
8. Keep false-completion benchmarking separate from UI concerns; mission-engine state is the verification source of truth.

## Explicit non-goals

- No frontend or UI dependencies.
- No model-provider SDKs.
- No direct database dependency.
- No automatic deployment side effects.
- No inference that a passing test is equivalent to satisfying a mission requirement.
- No caller-supplied `complete=true` flag is trusted.

## Phase 5 exit criterion

Phase 5 is considered implemented only when TypeScript, compiled tests, runtime tests, build, zero-`any` audit, and backend-isolation audit pass for the mission-engine package, with no Phase 5 changes to frontend/UI code.
