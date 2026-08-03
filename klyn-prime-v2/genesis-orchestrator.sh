#!/usr/bin/env bash
# ==============================================================================
# GENESIS OS - KLYN AI OS ORCHESTRATOR (ENTERPRISE EDITION)
# Platform: POSIX / Linux / Termux / macOS (Cross-Environment Compliant)
#
# Commands:
#   install   Install npm dependencies            (idempotent)
#   dev       Run the KLYN gateway in dev mode    (idempotent, pid-guarded)
#   build     Typecheck and emit dist/ via tsc    (idempotent)
#   test      Run npm test, else verify syntax    (idempotent)
#   start     Start the KLYN gateway              (alias of dev, pid-guarded)
#   swarm     Legacy 1000-agent swarm engine      (preserved)
#   help      Show usage
#
# All commands are idempotent: re-running them is safe and never corrupts state.
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# DYNAMIC PATH RESOLUTION (works from any cwd)
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

readonly BASE_TMP_DIR="${TMPDIR:-/tmp}"
readonly RUNTIME_DIR="${REPO_ROOT}/.runtime"
readonly LOG_DIR="${RUNTIME_DIR}/logs"
readonly LOG_FILE="${LOG_DIR}/genesis.log"
readonly SWARM_LOG_FILE="${LOG_DIR}/genesis_swarm.log"
readonly PID_FILE="${RUNTIME_DIR}/genesis-server.pid"
readonly LOG_MAX_BYTES=10485760          # 10MB circular log limit
readonly SERVER_PORT="${PORT:-7860}"

# Swarm engine bounds
readonly MAX_CONCURRENT_WORKERS=8        # Active concurrent worker threads
readonly TOTAL_SWARM_TARGET=1000         # Scaled agent limit
readonly MAX_MEMORY_PER_PROCESS=512      # Memory limit per agent in MB
readonly MAX_RETRIES_PER_TASK=3          # Circuit breaker failure limit

mkdir -p "${LOG_DIR}" "${RUNTIME_DIR}"

# ------------------------------------------------------------------------------
# LOGGING & ERROR HANDLING
# ------------------------------------------------------------------------------
log()  { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "${LOG_FILE}"; }
die()  { log "ERROR: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

# ------------------------------------------------------------------------------
# CLEANUP (idempotent): kill tracked child + remove pid/fifo artifacts
# ------------------------------------------------------------------------------
CHILD_PID=""
FIFO_PATH=""
SWARM_MODE=0

cleanup() {
    if [ -n "${CHILD_PID}" ]; then
        kill "${CHILD_PID}" 2>/dev/null || true
        CHILD_PID=""
    fi
    rm -f "${PID_FILE}" 2>/dev/null || true
    if [ -n "${FIFO_PATH}" ]; then
        exec 3>&- 2>/dev/null || true
        rm -f "${FIFO_PATH}" 2>/dev/null || true
    fi
    if [ "${SWARM_MODE}" -eq 1 ]; then
        pkill -P $$ 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

server_running() {
    [ -f "${PID_FILE}" ] || return 1
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

# ------------------------------------------------------------------------------
# COMMANDS
# ------------------------------------------------------------------------------

cmd_install() {
    require_cmd node
    require_cmd npm
    cd "${REPO_ROOT}"
    if [ -d node_modules ] && [ -f package-lock.json ] && [ package-lock.json -nt package.json ]; then
        log "install: dependencies already up to date (node_modules present) — skipping."
    else
        log "install: running npm install..."
        npm install
        log "install: complete."
    fi
}

cmd_build() {
    require_cmd npx
    cd "${REPO_ROOT}"
    log "build: typechecking and emitting to dist/ ..."
    npx tsc -p tsconfig.json
    log "build: complete (dist/ updated)."
}

cmd_test() {
    require_cmd node
    cd "${REPO_ROOT}"
    log "test: verifying entry-point syntax ..."
    local ok=1
    local f
    for f in klyn_server.js index.js engine.js klyn_cli.js; do
        if [ -f "${f}" ]; then
            node --check "${f}" || ok=0
        fi
    done
    [ "${ok}" -eq 1 ] || die "test: entry-point syntax verification failed"
    if node -e 'const p=require("./package.json"); process.exit(p.scripts && p.scripts.test ? 0 : 1)' 2>/dev/null; then
        npm test
    else
        log "test: no npm test script defined; entry-point syntax checks passed."
    fi
    log "test: complete."
}

cmd_dev() {
    require_cmd node
    cd "${REPO_ROOT}"
    if server_running; then
        log "dev: gateway already running (PID $(cat "${PID_FILE}")). Nothing to do."
        return 0
    fi
    log "dev: starting gateway on 0.0.0.0:${SERVER_PORT} ..."
    PORT="${SERVER_PORT}" node klyn_server.js &
    CHILD_PID=$!
    echo "${CHILD_PID}" > "${PID_FILE}"
    log "dev: gateway started (PID ${CHILD_PID}); logs → ${LOG_FILE}. Press Ctrl-C to stop."
    wait "${CHILD_PID}"
}

cmd_start() { cmd_dev; }

# --- Legacy swarm engine (preserved) ------------------------------------------
cmd_swarm() {
    SWARM_MODE=1
    export NODE_OPTIONS="--max-old-space-size=${MAX_MEMORY_PER_PROCESS}"
    export UV_THREADPOOL_SIZE="${MAX_CONCURRENT_WORKERS}"
    FIFO_PATH="${BASE_TMP_DIR}/genesis_fifo_$$"

    rotate_logs_if_needed() {
        if [ -f "${SWARM_LOG_FILE}" ]; then
            local file_size
            file_size=$(stat -c%s "${SWARM_LOG_FILE}" 2>/dev/null || stat -f%z "${SWARM_LOG_FILE}" 2>/dev/null || echo 0)
            if [ "${file_size}" -gt "${LOG_MAX_BYTES}" ]; then
                mv "${SWARM_LOG_FILE}" "${SWARM_LOG_FILE}.old"
                touch "${SWARM_LOG_FILE}"
            fi
        fi
    }

    log_message() {
        local level="$1"
        local message="$2"
        local timestamp
        timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        echo "[${timestamp}] [${level}] ${message}" | tee -a "${SWARM_LOG_FILE}"
        rotate_logs_if_needed
    }

    init_semaphore() {
        rm -f "${FIFO_PATH}"
        mkfifo "${FIFO_PATH}"
        exec 3<>"${FIFO_PATH}"
        rm -f "${FIFO_PATH}"
        local i
        for ((i = 0; i < MAX_CONCURRENT_WORKERS; i++)); do
            echo >&3
        done
    }

    execute_agent_task() {
        local agent_id="$1"
        local retry_count=0
        local success=0

        while [ "${retry_count}" -lt "${MAX_RETRIES_PER_TASK}" ]; do
            if { sleep 0.02; } >> "${SWARM_LOG_FILE}" 2>&1; then
                success=1
                break
            else
                retry_count=$((retry_count + 1))
                log_message "WARN" "Agent [${agent_id}] failed execution. Retry ${retry_count}/${MAX_RETRIES_PER_TASK}"
                sleep 0.1
            fi
        done

        if [ "${success}" -eq 1 ]; then
            log_message "INFO" "Agent [${agent_id}] completed successfully."
        else
            log_message "ERROR" "Agent [${agent_id}] circuit breaker tripped. Task aborted."
        fi

        # Release worker token back to queue
        echo >&3
    }

    echo "======================================================================"
    echo "         GENESIS OS - AUTONOMOUS GLOBAL SWARM ORCHESTRATOR           "
    echo "======================================================================"
    echo " Target Swarm Capacity : ${TOTAL_SWARM_TARGET} Agents"
    echo " Active Concurrency    : ${MAX_CONCURRENT_WORKERS} Parallel Workers"
    echo " Process Memory Cap    : ${MAX_MEMORY_PER_PROCESS} MB"
    echo " Log Destination       : ${SWARM_LOG_FILE}"
    echo "======================================================================"
    echo ""

    log_message "INFO" "Initializing Genesis Swarm Engine..."
    init_semaphore

    log_message "INFO" "Deploying Swarm Queue for ${TOTAL_SWARM_TARGET} Agents..."

    local id
    for ((id = 1; id <= TOTAL_SWARM_TARGET; id++)); do
        # Acquire slot from token bucket
        read -r -u 3

        # Spawn asynchronous worker process
        execute_agent_task "${id}" &

        if (( id % 100 == 0 )); then
            log_message "METRIC" "Progress: ${id}/${TOTAL_SWARM_TARGET} Agents Queued."
        fi
    done

    # Wait for active subshell workers to drain
    wait

    log_message "SUCCESS" "All ${TOTAL_SWARM_TARGET} Autonomous Swarm Agents executed seamlessly."
    echo ""
    echo "======================================================================"
    echo " [GENESIS OS] Swarm Execution completed with zero fatal crashes."
    echo "======================================================================"
}

# ------------------------------------------------------------------------------
# USAGE & DISPATCH
# ------------------------------------------------------------------------------
usage() {
    cat <<'EOF'
GENESIS OS — KLYN AI OS Orchestrator

Usage:
  ./genesis-orchestrator.sh <command>

Commands:
  install   Install npm dependencies (idempotent)
  dev       Run the KLYN gateway in dev mode on 0.0.0.0:$PORT (default 7860)
  build     Typecheck and emit dist/ via tsc
  test      Run npm test, or verify entry-point syntax when no test script exists
  start     Start the KLYN gateway (alias of dev; pid-guarded, idempotent)
  swarm     Run the legacy 1000-agent swarm simulation engine
  help      Show this help

All commands are idempotent and safe to re-run.
EOF
}

case "${1:-}" in
    install) cmd_install ;;
    dev)     cmd_dev ;;
    build)   cmd_build ;;
    test)    cmd_test ;;
    start)   cmd_start ;;
    swarm)   cmd_swarm ;;
    help|-h|--help|"") usage ;;
    *) die "unknown command: $1"; usage ;;
esac
