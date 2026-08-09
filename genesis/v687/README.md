# GENESIS v687 — AI Organization Operating System Layer

> **Mission:** Run organizations as programmable systems: roles, missions, and workflows as first-class objects.

> Evolution lineage: depends on `v686`.

## Architecture — 10 core TypeScript modules

| # | Module | Role |
|---|--------|------|
| 1 | `AIOrganizationOSKernel` | kernel — module registry & health |
| 2 | `OrganizationStructureOrchestrator` | orchestrator — ordered boot + reverse shutdown |
| 3 | `AIOrganizationRuntime` | runtime — guarded lifecycle state machine |
| 4 | `OrganizationGovernanceController` | controller — policy enforcement & quotas |
| 5 | `OrgWorkflowEngine` | engine — bounded work queue + tick loop |
| 6 | `OrganizationRoleRegistry` | registry — O(1) LRU entity store |
| 7 | `OrganizationCoordinationHub` | coordinator — contract-gated message bus |
| 8 | `OrganizationTelemetryObserver` | observer — ring-buffered telemetry |
| 9 | `OrgSystemAdapter` | adapter — environment probe & boundary calls |
| 10 | `AIOrganizationOSPlatform` | platform — composition root & public API |

## Contracts (event topics)

```
  v687.engine.tick
  v687.role.assigned
  v687.mission.completed
  v687.metric.recorded
```

## Quickstart

```bash
# materialize / regenerate this layer (idempotent)
node genesis/forge.mjs v687

# typecheck the whole genesis lineage (strict)
node_modules/.bin/tsc --noEmit -p genesis/tsconfig.json

# run this layer self-test
bun run genesis/v687/smoke.ts

# one-shot bootstrap (Termux / Linux)
bash genesis-v687-bootstrap.sh --smoke
```

## Boot a layer in code

```ts
import { createLayer } from './AIOrganizationOSPlatform.js';

const layer = createLayer();
const report = await layer.start();
console.log(layer.health(), report.totalMs);
await layer.stop();
```

## Push workflow

```bash
# commit this layer + push to GitHub (origin) and GitLab (gitlab)
bash genesis/push-evolution.sh v687

# or land everything
bash genesis/push-evolution.sh all
```
