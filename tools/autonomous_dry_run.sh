#!/bin/bash
set -euo pipefail
readonly KLYN_ROOT="${KLYN_ROOT:-$(pwd)}"
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_RESET='\033[0m'
PASSED_TESTS=0
TOTAL_TESTS=5
test_result() { local test_name="$1" result="$2"; if [[ "$result" == "PASS" ]]; then echo -e "[${COLOR_GREEN}PASS${COLOR_RESET}] ${test_name}"; PASSED_TESTS=$((PASSED_TESTS + 1)); else echo -e "[${COLOR_RED}FAIL${COLOR_RESET}] ${test_name}"; fi }
echo "=== KLYN AI OS Health Checks ==="
echo ""
[[ -d "${KLYN_ROOT}/kernel" ]] && test_result "Kernel directory structure" "PASS" || test_result "Kernel directory structure" "FAIL"
[[ -f "${KLYN_ROOT}/kernel/orchestrator.js" ]] && test_result "Kernel orchestrator module" "PASS" || test_result "Kernel orchestrator module" "FAIL"
[[ -f "${KLYN_ROOT}/package.json" ]] && test_result "Package configuration" "PASS" || test_result "Package configuration" "FAIL"
command -v node &> /dev/null && test_result "Node.js runtime" "PASS" || test_result "Node.js runtime" "FAIL"
mkdir -p "${KLYN_ROOT}/.klyn" 2>/dev/null && test_result "KLYN system directory" "PASS" || test_result "KLYN system directory" "FAIL"
echo ""
echo "=== Results: ${PASSED_TESTS}/${TOTAL_TESTS} PASS ==="
[[ $PASSED_TESTS -eq $TOTAL_TESTS ]] && exit 0 || exit 1
