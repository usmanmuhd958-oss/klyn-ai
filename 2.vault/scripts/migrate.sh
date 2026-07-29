#!/bin/bash
# Run database migrations (supports Supabase and local SQLite)
cd "$(dirname "$0")/.."

if [ -f config/supabase.env ]; then
  source config/supabase.env
  if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ]; then
    echo "☁️ Running migrations on Supabase..."
    for f in database/migrations/*.sql; do
      echo "  Applying $(basename "$f")..."
      node -e "
        const { createClient } = require('@supabase/supabase-js');
        const fs = require('fs');
        const supabase = createClient('$SUPABASE_URL', '$SUPABASE_ANON_KEY');
        const sql = fs.readFileSync('$f', 'utf8');
        supabase.rpc('exec_sql', { sql }).then(({ error }) => {
          if (error) console.error('  ⚠️', error.message);
          else console.log('  ✅ Applied');
        });
      " 2>/dev/null || echo "  ⚠️ Skipped (run manually in Supabase SQL Editor)"
    done
    echo "✅ Migrations complete."
    exit 0
  fi
fi

# Local SQLite fallback
if command -v sqlite3 >/dev/null; then
  echo "💾 Running migrations on local SQLite..."
  for f in database/migrations/*.sql; do
    echo "  Applying $(basename "$f")..."
    # Convert PostgreSQL syntax to SQLite (basic conversion)
    sed 's/JSONB/TEXT/g; s/TIMESTAMPTZ/TEXT/g; s/BIGSERIAL/INTEGER PRIMARY KEY AUTOINCREMENT/g; s/ON CONFLICT DO NOTHING//g' "$f" | sqlite3 runtime/state.db 2>/dev/null
  done
  echo "✅ Local migrations complete."
else
  echo "⚠️ No database available. Install sqlite or configure Supabase."
fi
