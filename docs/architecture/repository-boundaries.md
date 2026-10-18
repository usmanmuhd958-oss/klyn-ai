# KLYN OS repository boundaries and cleanup rules

## Canonical ownership

- `crates/klyn-daemon`: process lifecycle, IPC routing, request validation, authorization coordination, and audit events.
- `crates/klyn-sandbox`: worker bootstrap, fail-closed OS isolation, syscall/filesystem controls, and capability-scoped resource access.
- `crates/klyn-protocol`: versioned typed IPC contracts and wire-compatible messages.
- `crates/klyn-fs`: transactional filesystem semantics and publication/recovery.
- `packages/db-client` (`@klyn/db-client`): server-only Supabase adapter. No browser bundle may import a service-role client.
- `apps/backend`: external API validation and application composition; row-level security remains enforced by Postgres, not duplicated as ad hoc handler-only checks.
- `supabase/migrations`: append-only migration source-of-truth, using version prefixes that match the remote ledger.
- `.github/workflows/qualify.yml`: shared qualification gate. Pull-request jobs use disposable local Supabase credentials; live parity is protected-main-push-only and uses a read-only database URL.

The existing Rust workspace remains under `crates/`. Do not add duplicate root-level `klyn-daemon/` or `klyn-sandbox/` implementations.

## Cleanup procedure: review before remove

The repository includes an extensive migration backup, archive material, generated inventories, historic bootstrap scripts, and multiple certification workflows. Their names alone do not establish that they are orphans. Do not bulk-delete them.

From a clean local checkout:

```bash
git status --short
git switch -c chore/repo-cleanup-audit
git ls-files > /tmp/klyn-tracked-files.txt
git ls-files '.migration-backup/**' 'archive-history/**' 'bootstrap_*.sh' 'genesis-*-bootstrap.sh' '*.backup*' '*.save'
git grep -nE '(^|[[:space:]])(source|\\.|bash|sh)[[:space:]].*(bootstrap_|genesis-|archive-history|\\.migration-backup)' -- '*.sh' '*.yml' '*.yaml' '*.toml' '*.json'
git clean -ndX
```

Inspect each candidate against package scripts, imports, workflow references, deployment manifests, docs, and recovery procedures. Only remove individually reviewed paths:

```bash
git rm -- <reviewed-file-or-directory-paths>
git diff --cached --check
git diff --cached --stat
git status --short
```

Never run a broad `find ... -delete`, `rm -rf`, or indiscriminate deletion of `.migration-backup/`, `archive-history/`, root bootstrap scripts, inventory files, or certification workflows.

## Runtime secrets

- `.env.example` is placeholder-only; all real `.env*` files except `.env.example` are ignored.
- `DATABASE_URL` is a direct PostgreSQL URL for migration reconciliation/schema administration.
- `DATABASE_TRANSACTION_URL` is the Supavisor transaction pooler for short application queries, not migration execution.
- `SUPABASE_SERVICE_ROLE_KEY` is privileged and server-only. Inject it through the runtime secret store, never through public frontend variables, browser bundles, or logs.
