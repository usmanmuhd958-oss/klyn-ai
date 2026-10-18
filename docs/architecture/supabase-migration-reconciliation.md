# Supabase migration reconciliation status

Project: `fxuiljecdjgyffkjzqzl`  
Inspection date: 2026-10-18

## Remote ledger observed

The remote `supabase_migrations.schema_migrations` reports 15 versions:

`001`, `002`, `003`, `004`, `005`, `006`, `007`, `008`,
`20260915063124`, `20260915163336`, `20260915202015`,
`20261018144350`, `20261018144629`, `20261018145224`, `20261018151415`.

Seven timestamped records retain one SQL statement in the remote migration ledger. Their SQL was mirrored to version-correct files under `supabase/migrations/`. The previous three files whose prefixes disagreed with their remote version were removed on the sanitization branch.

The SQL for versions `001`–`008` is unavailable in the retained remote `statements` arrays, and an audit of the inspected repository tree did not find their original migration files.

## Why `000_core_schema_baseline.sql` is not inserted into the migration stream yet

A current catalog dump describes today's schema, after all 15 migrations. It cannot establish the exact historical schema at the end of version `008`. Putting a post-version-15 schema snapshot at version `000` and replaying the later migrations would duplicate table and policy definitions or fail on DDL that is not idempotent. Marking synthetic files as versions `001`–`008` would only fake parity, not reproduce the historical migration chain.

The safe baseline generator is `scripts/ci/generate-core-schema-baseline.sh`. It creates a catalog-derived *candidate snapshot* under `supabase/baselines/`, outside the migration folder, and an object inventory for review. This keeps the live `supabase_migrations.schema_migrations` history untouched. The generated snapshot is not a deployable migration until its intended baseline semantics and bootstrap path are reviewed.

## Required resolution for true zero-drift

1. Recover the original SQL for versions `001`–`008` from a trusted release artifact, historical repository, or backup.
2. If original SQL cannot be recovered, approve a formal squash strategy. Document the baseline point, how fresh environments bootstrap it, how migration history is retained, and how subsequent migrations are applied. Do not claim historical SQL parity.
3. Do not create empty/no-op placeholder migrations. Do not run `supabase migration repair` merely to make CI green.
4. Replay the exact chain into an empty local Supabase database, run schema lint, and run the synthetic tenant-isolation suite.
5. Verify the live migration version set on protected-branch pushes using a read-only `DATABASE_URL`.

## Current qualification state

**Not zero-drift yet.** The local migration closure check is deliberately fail-closed until SQL source for versions `001`–`008` is recovered or an approved squash procedure is completed. Mirroring available SQL does not prove historical completeness.
