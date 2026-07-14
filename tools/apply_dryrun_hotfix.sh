#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# KLYN AI OS — Dry Run Hotfix (Termux Flawless Edition)
# File: tools/apply_dryrun_hotfix.sh
# =============================================================================
set -euo pipefail

readonly KLYN_ROOT="/data/data/com.termux/files/home/klyn-ai-os"
readonly SCRIPT_PATH="$KLYN_ROOT/tools/autonomous_dry_run.sh"
readonly BACKUP_PATH="$KLYN_ROOT/tools/autonomous_dry_run.sh.backup-$(date +%s)"

# Color output
readonly C_GREEN='\033[0;32m'
readonly C_YELLOW='\033[1;33m'
readonly C_RED='\033[0;31m'
readonly C_RESET='\033[0m'

log_info()    { echo -e "${C_GREEN}[✓]${C_RESET} $*"; }
log_warn()    { echo -e "${C_YELLOW}[⚠]${C_RESET} $*"; }
log_error()   { echo -e "${C_RED}[✗]${C_RESET} $*"; }

# Check if script exists
if [[ ! -f "$SCRIPT_PATH" ]]; then
  log_error "Dry run script not found at: $SCRIPT_PATH"
  exit 1
fi

log_info "Found dry run script: $SCRIPT_PATH"

# Create backup
log_info "Creating backup: $BACKUP_PATH"
cp "$SCRIPT_PATH" "$BACKUP_PATH"

# Restore function (if something goes wrong)
restore_backup() {
  log_warn "Restoring original dry run script from backup..."
  cp "$BACKUP_PATH" "$SCRIPT_PATH"
  log_info "Original restored."
  exit 1
}
trap restore_backup ERR

# Apply hotfixes (direct inline sed - no /tmp files)
log_info "Applying hotfix #1: Removing 'readonly' constraints..."
sed -i 's/^readonly MUTATION_TARGET_FILE=/MUTATION_TARGET_FILE=/g' "$SCRIPT_PATH"
sed -i 's/^readonly TEST_TARGET_FILE=/TEST_TARGET_FILE=/g' "$SCRIPT_PATH"

log_info "Applying hotfix #2: Fixing Node.js module paths to absolute..."
sed -i "s|require('\.\.\/kernel/src/routing/cognitive_router')|require(process.env.KLYN_ROOT + '/kernel/src/routing/cognitive_router')|g" "$SCRIPT_PATH"
sed -i "s|require('\.\.\/kernel/src/observability/logger')|require(process.env.KLYN_ROOT + '/kernel/src/observability/logger')|g" "$SCRIPT_PATH"
sed -i "s|require('\.\.\/kernel/src/services/llama_monitor')|require(process.env.KLYN_ROOT + '/kernel/src/services/llama_monitor')|g" "$SCRIPT_PATH"
sed -i "s|require('\.\.\/kernel/src/execution/evolution_engine')|require(process.env.KLYN_ROOT + '/kernel/src/execution/evolution_engine')|g" "$SCRIPT_PATH"
sed -i "s|require('\.\.\/kernel/token-vault')|require(process.env.KLYN_ROOT + '/kernel/token-vault')|g" "$SCRIPT_PATH"
sed -i "s|require('\.\.\/kernel/src/observability/health_manifest')|require(process.env.KLYN_ROOT + '/kernel/src/observability/health_manifest')|g" "$SCRIPT_PATH"

log_info "Applying hotfix #3: Adding KLYN_ROOT to test execution calls..."
sed -i 's|timeout "$TASK_TIMEOUT" node "$test_script"|KLYN_ROOT="$KLYN_ROOT" timeout "$TASK_TIMEOUT" node "$test_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout 90 node "$test_script"|KLYN_ROOT="$KLYN_ROOT" timeout 90 node "$test_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout "$MUTATION_TIMEOUT" node "$test_script"|KLYN_ROOT="$KLYN_ROOT" timeout "$MUTATION_TIMEOUT" node "$test_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout 60 node "$rollback_script"|KLYN_ROOT="$KLYN_ROOT" timeout 60 node "$rollback_script"|g' "$SCRIPT_PATH"
sed -i 's|timeout "$HEALTH_CHECK_TIMEOUT" node "$health_script"|KLYN_ROOT="$KLYN_ROOT" timeout "$HEALTH_CHECK_TIMEOUT" node "$health_script"|g' "$SCRIPT_PATH"

log_info "Applying hotfix #4: Removing any 'export' from MUTATION_TARGET_FILE..."
sed -i 's/export MUTATION_TARGET_FILE=/MUTATION_TARGET_FILE=/g' "$SCRIPT_PATH"

# Verification
log_info "Verifying hotfix application..."
if grep -q "require(process.env.KLYN_ROOT" "$SCRIPT_PATH"; then
  log_info "Path fixes verified: Absolute require() paths detected"
else
  log_warn "Warning: Absolute paths not detected (check if correct dry_run file content is active)"
fi

if grep -q "^readonly MUTATION_TARGET_FILE=" "$SCRIPT_PATH"; then
  log_error "ERROR: 'readonly MUTATION_TARGET_FILE' still present!"
  restore_backup
else
  log_info "Readonly constraint removed successfully"
fi

trap - ERR  # clear trap, no more rollback

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Hotfix application complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Original backed up to: $BACKUP_PATH"
log_info "Patched script: $SCRIPT_PATH"
echo ""
log_info "Running the patched dry-run test now..."
cd "$KLYN_ROOT"
export KLYN_ROOT="$KLYN_ROOT"
bash "$SCRIPT_PATH" || log_warn "Dry-run test encountered an issue (but patching is complete)."
