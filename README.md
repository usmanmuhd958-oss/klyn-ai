# KLYN

KLYN is an AI-native engineering platform for planning, model orchestration, software execution, verification, and governed automation.

## Repository status

- Root package version: `6.1.0`
- Package manager: pnpm `11.24.0`
- Node.js requirement: `>=22`
- Repository state: active development

The repository contains the current workspace together with historical, generated, experimental, and runtime-oriented material. A directory name is not, by itself, an architecture contract.

## Canonical workspace

The package workspace is defined by `pnpm-workspace.yaml` and orchestrated by Turbo.

Primary surfaces include:

- `apps/backend` — HTTP service entrypoint, health/readiness endpoints, IPC exports, execution coordination, and runtime integration.
- `packages/ai-engine` — provider adapters, model routing, circuit breaking, token telemetry, context management, planning, swarm coordination, and spatial execution interfaces.
- `packages/agent-runtime` — agent execution and runtime state.
- `packages/execution-runtime` — execution primitives and persistence-backed runtime behavior.
- `packages/governance` and `packages/agent-governance` — policy and agent-governance boundaries.
- `packages/mission-engine`, `packages/workflow-engine`, and related runtime packages — planning, workflow, evolution, recovery, and coordination capabilities.

The complete workspace list is authoritative in `pnpm-workspace.yaml`.

## Architecture model

At a system level, KLYN separates five concerns:

1. **Intelligence** — model providers, routing, context selection, memory, and planning.
2. **Agents** — task execution, coordination, and role-specific behavior.
3. **Execution** — controlled runtime operations, state, persistence, and recovery.
4. **Governance** — policies, permissions, budgets, auditability, and trust boundaries.
5. **Interface and control plane** — backend APIs, health signals, orchestration, and external integration.

These boundaries are implemented across multiple packages; they are not a claim that every historical directory is active or production-critical.

## Local development

Install dependencies from the lockfile:

```bash
pnpm install --frozen-lockfile
```

Run the standard repository checks:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Start the backend in development mode:

```bash
pnpm dev
```

The backend reads its configuration from environment variables. By default it binds to `127.0.0.1:7860`. The required variables are `JWT_SECRET` and `ADMIN_PASSWORD`; provider credentials and Supabase credentials are optional at configuration-parse time.

Health endpoints:

```text
GET /health
GET /health/kernel
GET /ready
```

Start the compiled backend with:

```bash
pnpm start
```

## Source-of-truth rules

When architecture or behavior is ambiguous, prefer evidence in this order:

1. `pnpm-workspace.yaml`
2. package manifests under `apps/` and `packages/`
3. exported source modules and tests
4. deployment and runtime configuration
5. generated inventories and historical documentation

Do not infer capabilities from filenames, directory names, version labels, or marketing language alone.

## Repository hygiene

The repository includes historical and generated material, including inventories, runtime state, build artifacts, migration backups, and multiple evolutionary layers. These artifacts may be useful for experiments or traceability, but they are not automatically part of the active execution path.

Do not remove or consolidate modules solely because they look duplicated. Verify imports, package dependencies, scripts, tests, generation paths, and runtime references before deleting or merging code.

## Status and claims

KLYN is under active development. This README intentionally describes implemented repository structure and configured interfaces rather than claiming superiority, unlimited scale, perfect context retention, or production readiness that is not demonstrated by the repository itself.
