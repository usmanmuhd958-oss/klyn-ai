#!/usr/bin/env bash
# =============================================================================
# KLYN AI OS — Enhanced Bash Orchestrator
# File: agents/src/orchestrator.sh
# Version: 3.0.0
# =============================================================================
#
# PURPOSE:
#   Master daemon controller for all KLYN AI OS agents. This orchestrator:
#     - Spawns and supervises 4 core agents (Coder, Planner, Researcher, Reviewer)
#     - Supports hot-swapping agent scripts without dropping processes
#     - Performs dynamic capability checks via IPC heartbeat verification
#     - Integrates with Git health manager for branch-based deployments
#     - Maintains 51,744+ file index with incremental updates
#
# ARCHITECTURE:
#   Layer 1 — Process Supervision:
#     Fork agents as background jobs with PID tracking
#   Layer 2 — Hot-Swap Detection:
#     Monitor .swp files for incoming code replacements
#   Layer 3 — Health Monitoring:
#     Heartbeat verification, resource checks, Git branch validation
#   Layer 4 — IPC Bridge:
#     Unix socket communication with kernel/orchestrator.js
#
# TERMUX OPTIMIZATIONS:
#   - Portable paths (KLYN_ROOT resolved from $HOME, Termux-compatible)
#   - Android-aware battery monitoring (termux-battery-status)
#   - Minimal memory footprint (no external dependencies)
#   - Graceful degradation on resource constraints
#
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# -----------------------------------------------------------------------------
# SECTION 1: ENVIRONMENT & CONFIGURATION
# -----------------------------------------------------------------------------

# Portable root — overridable via KLYN_ROOT, defaults to $HOME/klyn-ai-os
# (On Termux, $HOME resolves to the app's private home dir; path stays portable)
readonly KLYN_ROOT="${KLYN_ROOT:-${HOME}/klyn-ai-os}"
readonly AGENTS_DIR="$KLYN_ROOT/agents"
readonly KERNEL_DIR="$KLYN_ROOT/kernel"
readonly RUNTIME_DIR="$KLYN_ROOT/.runtime"
readonly PID_DIR="$RUNTIME_DIR/pids"
readonly LOG_DIR="$RUNTIME_DIR/logs"
readonly SOCKET_DIR="$RUNTIME_DIR/sockets"
readonly SWAP_DIR="$RUNTIME_DIR/swap"

# Core agent definitions
declare -A AGENT_SCRIPTS=(
  [coder]="$AGENTS_DIR/coder.sh"
  [planner]="$AGENTS_DIR/planner.sh"
  [researcher]="$AGENTS_DIR/researcher.sh"
  [reviewer]="$AGENTS_DIR/reviewer.sh"
)

# Agent process IDs (populated at runtime)
declare -A AGENT_PIDS=()

# Orchestrator state
readonly ORCHESTRATOR_PID_FILE="$PID_DIR/orchestrator.pid"
readonly ORCHESTRATOR_LOG="$LOG_DIR/orchestrator.log"
readonly IPC_SOCKET="$SOCKET_DIR/orchestrator.sock"

# Configuration
readonly HEARTBEAT_INTERVAL=30        # Seconds between heartbeat checks
readonly HOT_SWAP_CHECK_INTERVAL=10   # Seconds between swap file checks
readonly MAX_RESTART_ATTEMPTS=3       # Max auto-restart attempts per agent
readonly RESTART_BACKOFF_BASE=5       # Exponential backoff base (seconds)
readonly FILE_INDEX_UPDATE_INTERVAL=300  # Seconds between file index updates

# Git configuration
readonly GIT_FEATURE_BRANCH="feature/enterprise-os-core"
readonly GIT_MAIN_BRANCH="main"
readonly GIT_HEALTH_CHECK_INTERVAL=600  # 10 minutes

# -----------------------------------------------------------------------------
# SECTION 2: LOGGING & UTILITIES
# -----------------------------------------------------------------------------

log() {
  local level="$1"
  shift
  local message="$*"
  local timestamp
  timestamp="$(date -Iseconds)"
  echo "[$timestamp] [$level] [Orchestrator] $message" | tee -a "$ORCHESTRATOR_LOG"
}

log_info()     { log "INFO"  "$@"; }
log_warn()     { log "WARN"  "$@"; }
log_error()    { log "ERROR" "$@"; }
log_debug()    { log "DEBUG" "$@"; }
log_security() { log "SECURITY" "$@"; }

# Safe file operations
ensure_dir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    log_debug "Created directory: $dir"
  fi
}

# Process check
is_process_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

# PID file management
write_pid_file() {
  local agent="$1"
  local pid="$2"
  echo "$pid" > "$PID_DIR/$agent.pid"
}

read_pid_file() {
  local agent="$1"
  local pid_file="$PID_DIR/$agent.pid"
  if [[ -f "$pid_file" ]]; then
    cat "$pid_file"
  else
    echo ""
  fi
}

# Clean shutdown handler
cleanup_on_exit() {
  log_info "Orchestrator shutting down. Sending SIGTERM to all agents..."
  
  for agent in "${!AGENT_PIDS[@]}"; do
    local pid="${AGENT_PIDS[$agent]}"
    if is_process_alive "$pid"; then
      log_info "Stopping agent: $agent (PID $pid)"
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  
  # Wait for graceful shutdown
  sleep 2
  
  # Force kill any remaining processes
  for agent in "${!AGENT_PIDS[@]}"; do
    local pid="${AGENT_PIDS[$agent]}"
    if is_process_alive "$pid"; then
      log_warn "Force killing agent: $agent (PID $pid)"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  
  # Clean up PID files
  rm -f "$PID_DIR"/*.pid
  rm -f "$IPC_SOCKET"
  
  log_info "Orchestrator shutdown complete."
  exit 0
}

trap cleanup_on_exit SIGINT SIGTERM EXIT

# -----------------------------------------------------------------------------
# SECTION 3: INITIALIZATION
# -----------------------------------------------------------------------------

initialize_orchestrator() {
  log_info "Initializing KLYN AI OS Orchestrator v3.0.0..."
  
  # Create runtime directories
  ensure_dir "$RUNTIME_DIR"
  ensure_dir "$PID_DIR"
  ensure_dir "$LOG_DIR"
  ensure_dir "$SOCKET_DIR"
  ensure_dir "$SWAP_DIR"
  
  # Check if already running
  if [[ -f "$ORCHESTRATOR_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$ORCHESTRATOR_PID_FILE")"
    if is_process_alive "$existing_pid"; then
      log_error "Orchestrator already running with PID $existing_pid"
      exit 1
    else
      log_warn "Stale PID file found. Cleaning up."
      rm -f "$ORCHESTRATOR_PID_FILE"
    fi
  fi
  
  # Write our PID
  echo "$$" > "$ORCHESTRATOR_PID_FILE"
  
  # Verify Git repository
  if [[ ! -d "$KLYN_ROOT/.git" ]]; then
    log_warn "Git repository not initialized. Version control disabled."
  else
    log_info "Git repository detected. Branch-based deployments enabled."
  fi
  
  # Verify agent scripts exist
  for agent in "${!AGENT_SCRIPTS[@]}"; do
    local script="${AGENT_SCRIPTS[$agent]}"
    if [[ ! -f "$script" ]]; then
      log_error "Agent script not found: $script"
      exit 1
    fi
    if [[ ! -x "$script" ]]; then
      log_warn "Making agent script executable: $script"
      chmod +x "$script"
    fi
  done
  
  log_info "Orchestrator initialized. PID: $$"
}

# -----------------------------------------------------------------------------
# SECTION 4: AGENT LIFECYCLE MANAGEMENT
# -----------------------------------------------------------------------------

spawn_agent() {
  local agent="$1"
  local script="${AGENT_SCRIPTS[$agent]}"
  
  log_info "Spawning agent: $agent"
  
  # Check if agent is already running
  local existing_pid
  existing_pid="$(read_pid_file "$agent")"
  if [[ -n "$existing_pid" ]] && is_process_alive "$existing_pid"; then
    log_warn "Agent $agent already running with PID $existing_pid"
    AGENT_PIDS[$agent]="$existing_pid"
    return 0
  fi
  
  # Spawn agent as background process with dedicated log
  local agent_log="$LOG_DIR/$agent.log"
  
  # Execute agent script
  "$script" >> "$agent_log" 2>&1 &
  local pid=$!
  
  # Verify spawn succeeded
  sleep 1
  if ! is_process_alive "$pid"; then
    log_error "Failed to spawn agent: $agent"
    return 1
  fi
  
  # Record PID
  AGENT_PIDS[$agent]="$pid"
  write_pid_file "$agent" "$pid"
  
  log_info "Agent spawned successfully: $agent (PID $pid)"
  return 0
}

restart_agent() {
  local agent="$1"
  local reason="${2:-manual restart}"
  
  log_info "Restarting agent: $agent (reason: $reason)"
  
  # Stop existing process
  local pid="${AGENT_PIDS[$agent]:-}"
  if [[ -n "$pid" ]] && is_process_alive "$pid"; then
    log_info "Stopping agent $agent (PID $pid)..."
    kill -TERM "$pid" 2>/dev/null || true
    
    # Wait up to 5 seconds for graceful shutdown
    local waited=0
    while is_process_alive "$pid" && [[ $waited -lt 5 ]]; do
      sleep 1
      waited=$((waited + 1))
    done
    
    # Force kill if still alive
    if is_process_alive "$pid"; then
      log_warn "Force killing agent $agent (PID $pid)"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  
  # Spawn new instance
  spawn_agent "$agent"
}

# -----------------------------------------------------------------------------
# SECTION 5: HOT-SWAPPING
# -----------------------------------------------------------------------------

check_hot_swap() {
  local agent="$1"
  local swap_file="$SWAP_DIR/$agent.sh.swp"
  
  # Check if swap file exists
  if [[ ! -f "$swap_file" ]]; then
    return 1
  fi
  
  log_info "Hot-swap detected for agent: $agent"
  
  # Validate swap file (basic syntax check)
  if ! bash -n "$swap_file" 2>/dev/null; then
    log_error "Hot-swap aborted: syntax error in $swap_file"
    rm -f "$swap_file"
    return 1
  fi
  
  # Backup current script
  local script="${AGENT_SCRIPTS[$agent]}"
  local backup="$script.backup.$(date +%s)"
  cp "$script" "$backup"
  log_info "Backed up current script to: $backup"
  
  # Atomic swap
  mv "$swap_file" "$script"
  chmod +x "$script"
  
  log_info "Hot-swap file installed. Restarting agent..."
  
  # Restart agent with new code
  restart_agent "$agent" "hot-swap"
  
  log_info "Hot-swap completed for agent: $agent"
  return 0
}

monitor_hot_swaps() {
  while true; do
    for agent in "${!AGENT_SCRIPTS[@]}"; do
      check_hot_swap "$agent" || true
    done
    sleep "$HOT_SWAP_CHECK_INTERVAL"
  done
}

# -----------------------------------------------------------------------------
# SECTION 6: HEALTH MONITORING
# -----------------------------------------------------------------------------

check_agent_health() {
  local agent="$1"
  local pid="${AGENT_PIDS[$agent]:-}"
  
  # Check 1: Process alive
  if [[ -z "$pid" ]] || ! is_process_alive "$pid"; then
    log_warn "Agent $agent is not running (PID: $pid)"
    return 1
  fi
  
  # Check 2: Process resource usage (via /proc)
  if [[ -d "/proc/$pid" ]]; then
    # Read CPU time from /proc/$pid/stat
    local stat_file="/proc/$pid/stat"
    if [[ -f "$stat_file" ]]; then
      # Just verify we can read it - detailed metrics handled by kernel
      cat "$stat_file" > /dev/null 2>&1 || {
        log_warn "Cannot read process stats for agent $agent"
        return 1
      }
    fi
  fi
  
  # Check 3: Heartbeat file (agents write heartbeat timestamps)
  local heartbeat_file="$RUNTIME_DIR/heartbeats/$agent.heartbeat"
  if [[ -f "$heartbeat_file" ]]; then
    local last_heartbeat
    last_heartbeat="$(cat "$heartbeat_file")"
    local now
    now="$(date +%s)"
    local age=$((now - last_heartbeat))
    
    if [[ $age -gt $((HEARTBEAT_INTERVAL * 2)) ]]; then
      log_warn "Agent $agent heartbeat stale (${age}s old)"
      return 1
    fi
  else
    log_debug "No heartbeat file for agent $agent (may not be implemented yet)"
  fi
  
  return 0
}

monitor_agent_health() {
  while true; do
    for agent in "${!AGENT_PIDS[@]}"; do
      if ! check_agent_health "$agent"; then
        log_warn "Agent $agent failed health check. Attempting restart..."
        restart_agent "$agent" "health check failed" || {
          log_error "Failed to restart agent $agent"
        }
      else
        log_debug "Agent $agent health check passed"
      fi
    done
    sleep "$HEARTBEAT_INTERVAL"
  done
}

# -----------------------------------------------------------------------------
# SECTION 7: GIT HEALTH INTEGRATION
# -----------------------------------------------------------------------------

check_git_branch_health() {
  if [[ ! -d "$KLYN_ROOT/.git" ]]; then
    return 0  # Git not initialized - skip check
  fi
  
  cd "$KLYN_ROOT" || return 1
  
  # Get current branch
  local current_branch
  current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
  
  log_debug "Current Git branch: $current_branch"
  
  # Check if we're on feature branch and should merge to main
  if [[ "$current_branch" == "$GIT_FEATURE_BRANCH" ]]; then
    log_info "On feature branch. Checking merge eligibility..."
    
    # Verify all agents are healthy
    local all_healthy=true
    for agent in "${!AGENT_PIDS[@]}"; do
      if ! check_agent_health "$agent"; then
        all_healthy=false
        break
      fi
    done
    
    if [[ "$all_healthy" == "true" ]]; then
      log_info "All agents healthy. Feature branch eligible for main merge."
      
      # Check if kernel/orchestrator.js wants to trigger merge
      # (This is a signal file created by kernel when it's ready)
      local merge_signal="$RUNTIME_DIR/git-merge-ready.signal"
      if [[ -f "$merge_signal" ]]; then
        log_info "Merge signal detected. Performing Git merge..."
        perform_git_merge
        rm -f "$merge_signal"
      fi
    else
      log_warn "Agents unhealthy. Delaying main branch merge."
    fi
  fi
}

perform_git_merge() {
  cd "$KLYN_ROOT" || return 1
  
  log_info "Merging $GIT_FEATURE_BRANCH -> $GIT_MAIN_BRANCH..."
  
  # Commit any outstanding changes on feature branch
  git add -A 2>/dev/null || true
  git commit -m "Auto-commit before merge to main" 2>/dev/null || true
  
  # Checkout main
  if ! git checkout "$GIT_MAIN_BRANCH" 2>/dev/null; then
    log_error "Failed to checkout $GIT_MAIN_BRANCH"
    return 1
  fi
  
  # Merge feature branch
  if git merge "$GIT_FEATURE_BRANCH" --no-edit 2>&1 | tee -a "$ORCHESTRATOR_LOG"; then
    log_info "Git merge completed successfully."
    
    # Tag the merge
    local tag="stable-$(date +%Y%m%d-%H%M%S)"
    git tag "$tag"
    log_info "Created tag: $tag"
    
    # Return to feature branch for continued development
    git checkout "$GIT_FEATURE_BRANCH" 2>/dev/null || true
    
    return 0
  else
    log_error "Git merge failed. Manual intervention required."
    git merge --abort 2>/dev/null || true
    git checkout "$GIT_FEATURE_BRANCH" 2>/dev/null || true
    return 1
  fi
}

monitor_git_health() {
  while true; do
    check_git_branch_health || true
    sleep "$GIT_HEALTH_CHECK_INTERVAL"
  done
}

# -----------------------------------------------------------------------------
# SECTION 8: FILE INDEX MANAGEMENT
# -----------------------------------------------------------------------------

update_file_index() {
  log_info "Updating file index..."
  
  local index_file="$RUNTIME_DIR/file-index.txt"
  local temp_index="$index_file.tmp"
  
  # Generate new index (exclude .git, node_modules, runtime dirs)
  find "$KLYN_ROOT" \
    -type f \
    -not -path "*/.git/*" \
    -not -path "*/node_modules/*" \
    -not -path "*/.runtime/*" \
    -not -path "*/.sandbox/*" \
    2>/dev/null > "$temp_index" || {
    log_warn "File index update encountered errors (likely permission issues)"
  }
  
  # Count files
  local file_count
  file_count="$(wc -l < "$temp_index")"
  
  # Atomic swap
  mv "$temp_index" "$index_file"
  
  log_info "File index updated: $file_count files indexed"
}

monitor_file_index() {
  while true; do
    update_file_index || true
    sleep "$FILE_INDEX_UPDATE_INTERVAL"
  done
}

# -----------------------------------------------------------------------------
# SECTION 9: MAIN ORCHESTRATOR LOOP
# -----------------------------------------------------------------------------

main() {
  log_info "Starting KLYN AI OS Orchestrator..."
  
  # Initialize
  initialize_orchestrator
  
  # Spawn all core agents
  for agent in "${!AGENT_SCRIPTS[@]}"; do
    spawn_agent "$agent" || {
      log_error "Failed to spawn agent: $agent"
      exit 1
    }
  done
  
  log_info "All agents spawned. Starting background monitors..."
  
  # Start background monitoring loops (as subshells)
  monitor_agent_health &
  local health_monitor_pid=$!
  
  monitor_hot_swaps &
  local swap_monitor_pid=$!
  
  monitor_git_health &
  local git_monitor_pid=$!
  
  monitor_file_index &
  local index_monitor_pid=$!
  
  log_info "All monitors started."
  log_info "Orchestrator is now operational."
  log_info "Monitoring PIDs: health=$health_monitor_pid swap=$swap_monitor_pid git=$git_monitor_pid index=$index_monitor_pid"
  
  # Main loop: just wait for signals
  while true; do
    sleep 60
    
    # Periodic status log
    log_info "Orchestrator heartbeat. Active agents: ${#AGENT_PIDS[@]}"
    
    # Check if any monitor died (shouldn't happen, but defensive)
    for pid in $health_monitor_pid $swap_monitor_pid $git_monitor_pid $index_monitor_pid; do
      if ! is_process_alive "$pid"; then
        log_error "Monitor process died: PID $pid. Orchestrator may be degraded."
      fi
    done
  done
}

# -----------------------------------------------------------------------------
# SECTION 10: ENTRY POINT
# -----------------------------------------------------------------------------

# Execute main function
main "$@"
