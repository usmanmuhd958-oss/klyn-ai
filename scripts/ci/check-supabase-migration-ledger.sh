#!/usr/bin/env bash
set -Eeuo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

manifest="supabase/remote-migration-ledger.txt"
migration_dir="supabase/migrations"

[[ -s "$manifest" ]] || { echo "::error::Missing remote migration ledger: $manifest"; exit 1; }
[[ -d "$migration_dir" ]] || { echo "::error::Missing $migration_dir"; exit 1; }

invalid=0
while IFS= read -r file; do
  name="${file##*/}"
  [[ "$name" =~ ^([0-9]{3}|[0-9]{14})_[a-z0-9_]+\.sql$ ]] || {
    echo "::error file=$file::Migration filename must be version-prefixed and lowercase."
    invalid=1
  }
done < <(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort)
(( invalid == 0 )) || exit 1

expected="$(grep -Ev '^[[:space:]]*(#|$)' "$manifest" | LC_ALL=C sort)"
actual="$(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sed -E 's/^([0-9]+)_.*/\1/' | LC_ALL=C sort)"

if [[ "$expected" != "$actual" ]]; then
  echo "::error::Local migrations do not close over the reviewed remote migration ledger."
  echo "Do not add empty placeholders or fabricate versions to silence this check."
  diff -u <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") || true
  exit 1
fi

echo "Local migration version set matches the reviewed remote ledger snapshot."
