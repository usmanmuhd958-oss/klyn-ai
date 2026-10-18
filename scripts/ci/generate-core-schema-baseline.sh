#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a read-only direct PostgreSQL URL}"
command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }

out="${1:-supabase/baselines/000_core_schema_baseline.sql}"
mkdir -p "$(dirname "$out")"

# Snapshot catalog metadata without table data, owners, ACLs or remote migration history.
# This is an audit/recovery artifact outside supabase/migrations until historical
# version semantics have been approved; do NOT replay it before the later migrations.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

pg_dump "$DATABASE_URL"   --schema-only   --no-owner   --no-privileges   --schema=public   --schema=private   --schema=extensions   --file="$tmp"

[[ -s "$tmp" ]] || { echo "pg_dump produced an empty schema snapshot" >&2; exit 1; }

{
  printf '%s\n' '-- KLYN OS catalog-derived schema baseline candidate.'
  printf '%s\n' '-- Generated from live PostgreSQL catalogs; not an original 001-008 migration.'
  printf '%s\n' '-- Keep outside supabase/migrations until a reviewed baseline strategy is approved.'
  printf '%s\n' '-- Remote supabase_migrations.schema_migrations is intentionally untouched.'
  cat "$tmp"
} > "$out"

# Capture a small catalog inventory beside the dump for peer review.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -At   -c "SELECT format('%I.%I|%s columns|RLS=%s',
                   c.table_schema, c.table_name, count(col.column_name),
                   coalesce(bool_or(cls.relrowsecurity), false))
      FROM information_schema.tables c
      JOIN pg_namespace ns ON ns.nspname = c.table_schema
      JOIN pg_class cls ON cls.relnamespace = ns.oid AND cls.relname = c.table_name
      LEFT JOIN information_schema.columns col
        ON col.table_schema = c.table_schema AND col.table_name = c.table_name
      WHERE c.table_type = 'BASE TABLE'
        AND c.table_schema IN ('public','private')
      GROUP BY c.table_schema, c.table_name
      ORDER BY c.table_schema, c.table_name" > "${out%.sql}.inventory.txt"

echo "Wrote candidate schema snapshot: $out"
echo "This is not yet a deployable migration and does not resolve migration-version drift."
