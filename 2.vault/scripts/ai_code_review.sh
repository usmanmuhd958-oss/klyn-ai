#!/bin/bash
# Sovereign Code Audit – uses shellcheck & grep (no external API)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="$PROJECT_ROOT/runtime/logs/audit_report.txt"
DIFF="$PROJECT_ROOT/runtime/logs/audit_fixes.diff"
mkdir -p "$(dirname "$REPORT")"
> "$REPORT"
> "$DIFF"

echo "📄 Auditing all shell scripts with shellcheck..."
find "$PROJECT_ROOT" -name "*.sh" -not -path "*/node_modules/*" -not -path "*/.git/*" -print0 |
  while IFS= read -r -d '' f; do
    shellcheck -f gcc "$f" >> "$REPORT" 2>/dev/null || true
  done

echo "🔍 Checking for common anti‑patterns..."
grep -rn "TODO\|FIXME\|HACK" --include="*.sh" --include="*.js" --include="*.py" "$PROJECT_ROOT" \
  | grep -v node_modules | grep -v .git >> "$REPORT" 2>/dev/null || true

echo "🔧 Suggesting fixes (diff format)..."
# Example: ensure all .sh files have shebangs
find "$PROJECT_ROOT" -name "*.sh" -not -path "*/node_modules/*" -not -path "*/.git/*" | while read f; do
  if ! head -1 "$f" | grep -q '^#!/'; then
    echo "--- a/$f" >> "$DIFF"
    echo "+++ b/$f" >> "$DIFF"
    echo "@@ -1,0 +1,1 @@" >> "$DIFF"
    echo "+#!/bin/bash" >> "$DIFF"
  fi
done

# Make all .sh executable if not already
find "$PROJECT_ROOT" -name "*.sh" -not -perm -111 -print0 | while IFS= read -r -d '' f; do
  echo "chmod +x $f" >> "$DIFF"
done

echo "✅ Audit complete. Report: $REPORT"
echo "   Review and apply fixes manually:  patch -p1 < $DIFF"
