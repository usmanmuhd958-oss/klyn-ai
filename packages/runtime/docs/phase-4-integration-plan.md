# Phase 4 Integration Plan — `@klyn/runtime`

## Purpose

`@klyn/runtime` is the hardware-aware execution fabric between Klyn's intent/planning layer and concrete execution adapters. It owns deterministic task classification, hardware topology resolution, resource admission, sandbox-plan construction, and post-execution verification.

The package deliberately has no frontend/UI dependencies and no direct dependency on model providers.

## Integration boundary

```text
Intent / Task Graph
        |
        v
@klyn/runtime
  1. parse + validate task boundary
  2. classify workload
  3. resolve CPU / GPU / remote targets
  4. enforce runtime + hardware ceilings
  5. construct deterministic sandbox plan
        |
        v
Execution Adapter
  - local process sandbox adapter
  - container / micro-VM adapter
  - remote cluster adapter
        |
        v
Runtime observation
        |
        v
@klyn/runtime verification gate
        |
        +--> SUCCEEDED_VERIFIED
        +--> UNVERIFIED
        +--> FAILED
```

## Phase 4.1 — package registration

After Phase 4 approval, add `packages/runtime` to `pnpm-workspace.yaml` and update the frozen lockfile in the same controlled change. Do not register it before the subsystem itself is approved.

## Phase 4.2 — execution-runtime adapter

Implement an adapter around the existing process/sandbox runtime. The adapter must consume `ExecutionPlan.sandbox` and `ExecutionPlan.resources` rather than reconstructing limits independently.

Expected mapping:

- `IsolationMode.PROCESS` -> existing process sandbox boundary.
- `IsolationMode.CONTAINER` -> container runtime adapter with explicit filesystem/network policy.
- `IsolationMode.MICRO_VM` -> micro-VM adapter.
- `IsolationMode.REMOTE_SANDBOX` -> remote cluster execution adapter.

The Phase 4 core does not spawn host processes itself.

## Phase 4.3 — governance handoff

The approved `@klyn/governance` subsystem should provide the authorization decision before `RuntimeExecutionFabric.execute()` is invoked. The integration adapter should bind:

- principal/session identity
- permitted target scope
- tool/operation scope
- risk ceiling
- required evidence policy

`@klyn/runtime` remains independent of the governance package at this stage so the execution fabric remains testable and deployment-neutral.

## Phase 4.4 — evidence handoff

The runtime adapter should emit its final `RuntimeExecutionResult` to the governance evidence chain. A `SUCCEEDED_VERIFIED` runtime result is necessary execution evidence; it is not by itself proof that the overall task objective is satisfied.

## Hardware discovery model

Local hardware is represented by `NodeHardwareTopologyProvider`. GPU discovery and remote cluster discovery are injected capabilities so topology collection can be supplied by platform-specific agents without contaminating the deterministic core.

Remote targets must report:

- CPU capacity
- memory capacity
- GPU count and aggregate GPU memory
- estimated latency
- region and network zone
- isolation capability
- supported accelerator classes

## Resource enforcement model

Admission is rejected unless the selected target satisfies task requirements and the global runtime ceiling. The following dimensions are enforced:

- CPU cores
- CPU milliseconds
- memory bytes
- wall-clock milliseconds
- GPU count
- GPU memory bytes
- network request count
- artifact bytes

Post-execution usage is compared against the immutable execution plan. A resource overrun cannot produce `SUCCEEDED_VERIFIED`.

## Determinism requirements

For identical task input, topology snapshot, policy, and resource plan, the following values must be stable:

- classification
- ordered hardware candidates
- selected target
- sandbox identity
- deterministic seed
- resource-plan hash

Topology snapshots used in deterministic tests must be immutable fixtures with fixed timestamps and explicit versions.

## Rollout sequence

1. Approve Phase 4 package and certification.
2. Register workspace and refresh lockfile.
3. Integrate local process sandbox adapter.
4. Integrate governance authorization adapter.
5. Integrate remote cluster adapter.
6. Promote verified runtime observations into the governance evidence chain.
7. Add production telemetry around admission rejections, placement, resource usage, and verification failures.

No Phase 5 work belongs in this rollout.
