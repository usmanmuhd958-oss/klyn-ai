# KLYN Local Development and Service Verification

## Prerequisites

- Node.js `>=22`
- pnpm `11.24.0`
- A working checkout of the KLYN repository

The canonical workspace is defined in `pnpm-workspace.yaml`.

## Install

Use the lockfile for reproducible dependency installation:

```bash
pnpm install --frozen-lockfile
```

## Validate the workspace

Run the repository-level checks:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

These commands are the configured root scripts. A failing check should be treated as a repository state issue, not masked by bypassing validation.

## Run the backend

Start the backend in development mode:

```bash
pnpm dev
```

The backend defaults to:

```text
HOST=127.0.0.1
PORT=7860
```

`JWT_SECRET` must contain at least 32 characters and `ADMIN_PASSWORD` at least 12 characters. Provider credentials and Supabase credentials are optional when the configuration is parsed, but features that depend on them still require valid credentials.

## Verify service health

After startup, check:

```bash
curl http://127.0.0.1:7860/health
curl http://127.0.0.1:7860/health/kernel
curl http://127.0.0.1:7860/ready
```

The exact response semantics are defined by `apps/backend/src/app.ts` and its health controllers.

## Run the compiled service

Build first:

```bash
pnpm build
```

Then:

```bash
pnpm start
```

## Deployment discipline

The root package configuration defines the development, build, test, typecheck, and lint workflows. It does not define one universal production target.

Before a production deployment, validate the target-specific infrastructure configuration, secrets, health checks, rollback path, and runtime dependencies. Do not treat legacy root scripts or historical deployment notes as authoritative without verifying their references against the current workspace.
