#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN ARCHITECTURE WALL CHECK"
echo " PRODUCTION IMPORT GOVERNANCE"
echo "======================================"

FORBIDDEN_PATHS=(
"genesis/"
"archive-history/"
"klyn-prime/"
"2.vault/"
)

FAILED=0

for path in "${FORBIDDEN_PATHS[@]}"
do
    echo ""
    echo "Checking: $path"

    RESULTS=$(grep -R --include="*.ts" --include="*.tsx" "$path" packages kernel intelligence apps 2>/dev/null || true)

    if [ -n "$RESULTS" ]; then
        echo "❌ FORBIDDEN IMPORT FOUND"
        echo "$RESULTS"
        FAILED=1
    else
        echo "✅ Clean"
    fi
done


if [ "$FAILED" -eq 1 ]; then
    echo ""
    echo "ARCHITECTURE WALL FAILED"
    exit 1
fi


echo ""
echo "======================================"
echo " ARCHITECTURE WALL PASSED"
echo " PRODUCTION TREE CLEAN"
echo "======================================"
