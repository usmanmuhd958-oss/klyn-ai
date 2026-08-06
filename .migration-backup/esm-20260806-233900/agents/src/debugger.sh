#!/bin/bash

set -e
set -u

# KLYN Debugger Agent
# Handles log analysis, memory checks, and disk diagnostics

TASK="$1"
PROJECT_ROOT="${KLYN_PROJECT_ROOT:-.}"
LOG_PATH="${KLYN_LOG_PATH:-${PROJECT_ROOT}/kernel/logs/orchestrator.log}"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] [DEBUGGER] $*" >> "${LOG_PATH}"
  echo "[DEBUGGER] $*"
}

error_exit() {
  log "ERROR: $*"
  exit 1
}

# Analyze log file for errors and anomalies
analyze_log() {
  local log_file="$1"

  if [[ ! -f "${log_file}" ]]; then
    error_exit "Log file not found: ${log_file}"
  fi

  log "Analyzing log file: ${log_file}"

  echo "=== LOG ANALYSIS REPORT ==="
  echo "File: ${log_file}"
  echo "Last modified: $(stat -c %y "${log_file}" 2>/dev/null || date)"
  echo "File size: $(wc -c < "${log_file}") bytes"
  echo ""

  echo "--- ERROR SUMMARY ---"
  local error_count
  error_count=$(grep -c '\[ERROR\]' "${log_file}" || echo 0)
  echo "Total errors: ${error_count}"

  echo ""
  echo "--- WARNING SUMMARY ---"
  local warn_count
  warn_count=$(grep -c '\[WARN\]' "${log_file}" || echo 0)
  echo "Total warnings: ${warn_count}"

  echo ""
  echo "--- RECENT ENTRIES (last 20 lines) ---"
  tail -n 20 "${log_file}"

  if [[ ${error_count} -gt 0 ]]; then
    echo ""
    echo "--- CRITICAL ERRORS ---"
    grep '\[ERROR\]' "${log_file}" | tail -n 5 || true
  fi

  log "Log analysis completed for: ${log_file}"
  echo "Log analysis completed successfully"
}

# Check system memory usage
check_memory() {
  log "Checking memory usage"

  echo "=== MEMORY DIAGNOSTICS ==="

  if command -v free &> /dev/null; then
    echo "--- Free Memory (kb) ---"
    free -k || true
    echo ""
  fi

  if [[ -r /proc/meminfo ]]; then
    echo "--- /proc/meminfo ---"
    cat /proc/meminfo | grep -E "^(MemTotal|MemFree|MemAvailable|Cached)" || true
    echo ""
  fi

  local node_processes
  node_processes=$(ps aux | grep -c 'node' || echo 0)
  echo "Active Node.js processes: ${node_processes}"

  log "Memory check completed"
  echo "Memory diagnostics completed"
}

# Check disk space
check_disk() {
  log "Checking disk usage"

  echo "=== DISK DIAGNOSTICS ==="

  echo "--- Disk usage ---"
  df -h || true

  echo ""
  echo "--- Project directory usage ---"
  if [[ -d "${PROJECT_ROOT}" ]]; then
    du -sh "${PROJECT_ROOT}" 2>/dev/null || echo "Unable to calculate directory size"
  else
    echo "Project root not found: ${PROJECT_ROOT}"
  fi

  echo ""
  echo "--- Inode usage ---"
  df -i "${PROJECT_ROOT}" || true

  log "Disk check completed"
  echo "Disk diagnostics completed"
}

# Main execution
log "Task received: ${TASK}"

if [[ "${TASK}" =~ ^analyze_log[[:space:]]+(.+)$ ]]; then
  log_file="${BASH_REMATCH[1]}"
  analyze_log "${log_file}"

elif [[ "${TASK}" =~ ^check_memory$ ]]; then
  check_memory

elif [[ "${TASK}" =~ ^check_disk$ ]]; then
  check_disk

else
  error_exit "Unknown or malformed task format: ${TASK}"
fi

log "Debugger agent task completed successfully"
exit 0

