#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a direct PostgreSQL connection}"
command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }

mkdir -p supabase/migrations
while read -r version filename; do
  [[ -z "${version:-}" || "$version" == \#* ]] && continue
  target="supabase/migrations/$filename"
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT

  psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1     -v migration_version="$version"     -c "SELECT statements[1]
        FROM supabase_migrations.schema_migrations
        WHERE version = :'migration_version'
          AND cardinality(statements) = 1" > "$tmp"

  if [[ ! -s "$tmp" ]] || ! grep -q '[^[:space:]]' "$tmp"; then
    echo "ERROR: No retained single-statement SQL source for $version" >&2
    exit 1
  fi

  install -m 0644 "$tmp" "$target"
  rm -f "$tmp"
  trap - EXIT
  printf 'Mirrored %s\n' "$target"
done <<'MIGRATIONS'
20260915063124 20260915063124_009_execution_ledger_realtime.sql
20260915163336 20260915163336_planner_bridge_execution_state.sql
20260915202015 20260915202015_planner_execution_cas_and_timestamps.sql
20261018144350 20261018144350_klyn_security_cas_boundary.sql
20261018144629 20261018144629_klyn_team_members_owner_boundary.sql
20261018145224 20261018145224_klyn_final_cleanup.sql
20261018151415 20261018151415_klyn_advisor_hardening.sql
MIGRATIONS
