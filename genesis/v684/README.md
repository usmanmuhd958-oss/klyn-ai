# GENESIS v684 — AI Research Civilization Platform Layer

> **Mission:** An autonomous research civilization: hypothesis, experiment, publish, and replicate at machine speed.

> Evolution lineage: depends on `v683`.

## Architecture — 10 core TypeScript modules

| # | Module | Role |
|---|--------|------|
| 1 | `ResearchCivilizationKernel` | kernel — module registry & health |
| 2 | `ResearchProgramOrchestrator` | orchestrator — ordered boot + reverse shutdown |
| 3 | `ResearchCivilizationRuntime` | runtime — guarded lifecycle state machine |
| 4 | `ResearchGovernanceController` | controller — policy enforcement & quotas |
| 5 | `ExperimentExecutionEngine` | engine — bounded work queue + tick loop |
| 6 | `ResearchPublicationRegistry` | registry — O(1) LRU entity store |
| 7 | `ResearchCoordinationHub` | coordinator — contract-gated message bus |
| 8 | `ResearchTelemetryObserver` | observer — ring-buffered telemetry |
| 9 | `ComputeClusterAdapter` | adapter — environment probe & boundary calls |
| 10 | `AIResearchCivilizationPlatform` | platform — composition root & public API |

## Contracts (event topics)

```
  v684.engine.tick
  v684.experiment.run
  v684.paper.published
  v684.metric.recorded
```

## Quickstart

```bash
# materialize / regenerate this layer (idempotent)
node genesis/forge.mjs v684

# typecheck the whole genesis lineage (strict)
node_modules/.bin/tsc --noEmit -p genesis/tsconfig.json

# run this layer self-test
bun run genesis/v684/smoke.ts

# one-shot bootstrap (Termux / Linux)
bash genesis-v684-bootstrap.sh --smoke
```

## Boot a layer in code

```ts
import { createLayer } from './AIResearchCivilizationPlatform.js';

const layer = createLayer();
const report = await layer.start();
console.log(layer.health(), report.totalMs);
await layer.stop();
```

## Push workflow

```bash
# commit this layer + push to GitHub (origin) and GitLab (gitlab)
bash genesis/push-evolution.sh v684

# or land everything
bash genesis/push-evolution.sh all
```
