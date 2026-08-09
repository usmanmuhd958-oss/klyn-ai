# GENESIS v683 — Universal Agent Marketplace Layer

> **Mission:** A global exchange where agents are listed, priced, verified, and composed on demand.

> Evolution lineage: depends on `v682`.

## Architecture — 10 core TypeScript modules

| # | Module | Role |
|---|--------|------|
| 1 | `AgentMarketplaceKernel` | kernel — module registry & health |
| 2 | `MarketplaceExchangeOrchestrator` | orchestrator — ordered boot + reverse shutdown |
| 3 | `AgentMarketplaceRuntime` | runtime — guarded lifecycle state machine |
| 4 | `MarketplaceGovernanceController` | controller — policy enforcement & quotas |
| 5 | `ListingAuctionEngine` | engine — bounded work queue + tick loop |
| 6 | `AgentListingRegistry` | registry — O(1) LRU entity store |
| 7 | `MarketplaceCoordinationHub` | coordinator — contract-gated message bus |
| 8 | `MarketplaceTelemetryObserver` | observer — ring-buffered telemetry |
| 9 | `PaymentSettlementAdapter` | adapter — environment probe & boundary calls |
| 10 | `UniversalAgentMarketplacePlatform` | platform — composition root & public API |

## Contracts (event topics)

```
  v683.engine.tick
  v683.agent.listed
  v683.deal.settled
  v683.metric.recorded
```

## Quickstart

```bash
# materialize / regenerate this layer (idempotent)
node genesis/forge.mjs v683

# typecheck the whole genesis lineage (strict)
node_modules/.bin/tsc --noEmit -p genesis/tsconfig.json

# run this layer self-test
bun run genesis/v683/smoke.ts

# one-shot bootstrap (Termux / Linux)
bash genesis-v683-bootstrap.sh --smoke
```

## Boot a layer in code

```ts
import { createLayer } from './UniversalAgentMarketplacePlatform.js';

const layer = createLayer();
const report = await layer.start();
console.log(layer.health(), report.totalMs);
await layer.stop();
```

## Push workflow

```bash
# commit this layer + push to GitHub (origin) and GitLab (gitlab)
bash genesis/push-evolution.sh v683

# or land everything
bash genesis/push-evolution.sh all
```
