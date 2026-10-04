# KLYN Control Plane Architecture v1

## 1. ROLE

KLYN is a deterministic backend control plane for autonomous execution. Agents are constrained principals. The control plane owns authorization, resource envelopes, scheduling, verification, state transitions, and immutable evidence.

## 2. OBJECTIVE

Enforce the invariant that execution occurs only when identity, capability, envelope, isolation, state, observability, verification, and audit requirements are satisfied.

## 3. CONTEXT

The trust model separates untrusted intent and agent processes from trusted control-plane services and isolated execution runtimes. All cross-boundary actions are authenticated and policy checked.

## 4. SCOPE

The implementation covers the immutable mission ledger, resource and permission envelopes, heterogeneous scheduling, context locality, sandbox lifecycle, anomaly detection, and the eight-state Verifiable Mission Graph.

## 5. CONSTRAINTS

The default is fail-closed. Unknown state, stale version, expired envelope, unauthorized capability, exhausted budget, ledger mismatch, or active circuit breaker prevents admission. Mutations require optimistic version checks.

## 6. PROCESS & DETAILED MODULE SPECIFICATIONS

### Module 1 — Immutable Mission Ledger

Events use canonical serialization, SHA-256 payload hashes, monotonically increasing per-mission sequence numbers, and previous-hash chaining. Merkle checkpoints provide compact integrity anchors. Behavioral anomaly detection evaluates identity, capability, resource, temporal, state, sequence, artifact, and infrastructure dimensions.

### Module 2 — Resource & Permission Envelope

Each execution receives a signed envelope with token, CPU, memory, GPU, IO, latency, capabilities, and network limits. Reservations are aggregate-bounded before admission. Credential grants are execution-bound and capped at 900 seconds. Sandbox lifecycle policy supports container and MicroVM drivers.

### Module 3 — Heterogeneous Scheduler

Mission intent is translated into execution requirements. Hard constraints filter workers before placement scoring. Privacy and locality constraints are never converted into soft preferences.

### Module 4 — Context Locality & Topology

Mission knowledge is represented as a DAG with L0 active state, L1 semantic memory, and L2 immutable history references. Projections prioritize critical state and provenance while reducing repeated payload transfer.

### Module 5 — Verifiable Mission Graph

Allowed transitions are strictly ordered:

INTENT_CAPTURED -> ENVELOPE_DEFINED -> PLAN_GENERATED -> ACTION_EXECUTED -> ARTIFACT_PRODUCED -> AUTOMATED_VERIFICATION -> HUMAN_APPROVAL -> PRODUCTION_ROLLOUT_AUDITED

Transition guards validate version, breaker state, and state-specific evidence before an atomic ledger-plus-state commit.

## 7. OUTPUT: PROTOCOL CONTRACTS & CONTROL PLANE INTERFACES

gRPC is defined in `proto/mission_control.proto`. JSON contracts are defined in `contracts/control-plane.schema.json`. OpenAPI is defined in `openapi/control-plane.yaml`. PostgreSQL persistence and atomic functions are defined in `sql/001_control_plane.sql`.

## 8. ACCEPTANCE CRITERIA

The package contains typed control-plane engines, immutable ledger validation, Merkle checkpoints, breaker escalation, budget enforcement, short-lived credentials, scheduler admission, DAG validation, sandbox lifecycle guards, atomic PostgreSQL transition functions, gRPC/JSON/OpenAPI contracts, and invariant tests.
