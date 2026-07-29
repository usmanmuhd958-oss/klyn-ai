#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "[SELF‑IMPROVER] Scanning codebase for improvements..."

# Find TODO/FIXME/HACK comments
echo "=== Code Quality Issues ==="
grep -rn "TODO\|FIXME\|HACK\|XXX" "$PROJECT_ROOT" --include="*.sh" --include="*.js" --include="*.py" --include="*.ts" | head -20

# Find duplicated code (simple hash check)
echo ""
echo "=== Duplicate Code Candidates ==="
find "$PROJECT_ROOT" -name "*.sh" -exec md5sum {} \; | sort | uniq -d -w32

# Auto‑fix: add missing shebangs
echo ""
echo "=== Auto‑fixing shebangs ==="
for f in $(find "$PROJECT_ROOT" -name "*.sh" ! -exec grep -q '^#!/' {} \; -print); do
    sed -i '1i#!/bin/bash' "$f"
    echo "Fixed: $f"
done

# Auto‑fix: make all .sh executable
find "$PROJECT_ROOT" -name "*.sh" -exec chmod +x {} \;

# Suggest module extraction
echo ""
echo "=== Suggestions ==="
echo "Consider extracting these large files into modules:"
find "$PROJECT_ROOT" -name "*.sh" -size +10k -exec ls -lh {} \;

echo ""
echo "Self‑improvement cycle complete. Run again to evolve further."
