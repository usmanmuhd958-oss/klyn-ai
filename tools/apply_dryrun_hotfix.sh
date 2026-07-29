#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# KLYN AI OS — Dry Run Hotfix
# =============================================================================

set -euo pipefail

readonly KLYN_ROOT="/data/data/com.termux/files/home/klyn-ai-os"
readonly SCRIPT_PATH="$KLYN_ROOT/tools/autonomous_dry_run.sh"
readonly BACKUP_PATH="$KLYN_ROOT/tools/autonomous_dry_run.sh.backup-$(date +%s)"

readonly C_GREEN='\033[0;32m'
readonly C_YELLOW='\033[1;33m'
readonly C_RED='\033[0;31m'
readonly C_RESET='\033[0m'

log_info()  { echo -e "${C_GREEN}[✓]${C_RESET} $*"; }
log_warn()  { echo -e "${C_YELLOW}[⚠]${C_RESET} $*"; }
log_error() { echo -e "${C_RED}[✗]${C_RESET} $*"; }

if [[ ! -f "$SCRIPT_PATH" ]]; then
  log_error "Dry run script not found at: $SCRIPT_PATH"
  exit 1
fi

log_info "Creating backup: $BACKUP_PATH"
cp "$SCRIPT_PATH" "$BACKUP_PATH"

log_info "Applying hotfix #1: Removing 'readonly' constraints..."
sed -i 's/^readonly MUTATION_TARGET_FILE=/MUTATION_TARGET_FILE=/g' "$SCRIPT_PATH"
sed -i 's/^readonly TEST_TARGET_FILE=/TEST_TARGET_FILE=/g' "$SCRIPT_PATH"

log_info "Applying hotfix #2: Fixing Node.js module paths..."
sed -i "s|require('../kernel/src/routing/cognitive_router')|require(process.env.KLYN_ROOT + '/kernel/src/routing/cognitive_router')|g" "$SCRIPT_PATH"
sed -i "s|require('../kernel/src/observability/logger')|require(process.env.KLYN_ROOT + '/kernel/src/observability/logger')|g" "$SCRIPT_PATH"
sed -i "s|require('../kernel/src/services/llama_monitor')|require(process.env.KLYN_ROOT + '/kernel/src/services/llama_monitor')|g" "$SCRIPT_PATH"
sed -i "s|require('../kernel/src/execution/evolution_engine')|require(process.env.KLYN_ROOT + '/kernel/src/execution/evolution_engine')|g" "$SCRIPT_PATH"
sed -i "s|require('../kernel/token-vault')|require(process.env.KLYN_ROOT + '/kernel/token-vault')|g" "$SCRIPT_PATH"
sed -i "s|require('../kernel/src/observability/health_manifest')|require(process.env.KLYN_ROOT + '/kernel/src/observability/health_manifest')|g" "$SCRIPT_PATH"

log_info "Applying hotfix #3: Adding KLYN_ROOT to test script environments..."
sed -i 's|timeout "\$TASK_TIMEOUT" node "\$test_script"|KLYN_ROOT="$KLYN_ROOT" timeout "$TASK_TIMEOUT" node "$test_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout 90 node "\$test_script"|KLYN_ROOT="$KLYN_ROOT" timeout 90 node "$test_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout "\$MUTATION_TIMEOUT" node "\$test_script"|KLYN_ROOT="$KLYN_ROOT" MUTATION_TARGET_FILE="$MUTATION_TARGET_FILE" timeout "$MUTATION_TIMEOUT" node "$test_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout 60 node "\$rollback_script"|KLYN_ROOT="$KLYN_ROOT" timeout 60 node "$rollback_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout "\$HEALTH_CHECK_TIMEOUT" node "\$health_script"|KLYN_ROOT="$KLYN_ROOT" timeout "$HEALTH_CHECK_TIMEOUT" node "$health_script"|g' "$SCRIPT_PATH"

log_info "Verifying hotfix application..."
if grep -q "require(process.env.KLYN_ROOT" "$SCRIPT_PATH"; then
  log_info "Path fixes verified ✓"
else
  log_warn "Warning: Path fixes may need manual verification"
fi

if grep -q "^readonly MUTATION_TARGET_FILE=" "$SCRIPT_PATH"; then
  log_error "ERROR: 'readonly MUTATION_TARGET_FILE' still present!"
else
  log_info "Readonly constraints removed ✓"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Hotfix applied successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Backup: $BACKUP_PATH"
log_info "Patched: $SCRIPT_PATH"
echo ""
log_info "Run the fixed dry run with:"
echo "  export KLYN_ROOT=/data/data/com.termux/files/home/klyn-ai-os"
echo "  bash tools/autonomous_dry_run.sh"
echo ""
