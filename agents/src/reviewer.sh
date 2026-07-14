#!/usr/bin/env bash
# =============================================================
# KLYN AI OS — Reviewer Agent v2.0.0
#
# Role:
#   Monitors the reviewer mailbox queue for review-request
#   messages, performs static analysis on generated code,
#   scores it against quality rubric, and emits a structured
#   review report back to the kernel.
#
# Invocation modes:
#   bash reviewer.sh                → daemon mode (default)
#   bash reviewer.sh daemon         → explicit daemon
#   bash reviewer.sh review         → one-shot review cycle
#   bash reviewer.sh status         → print status
#   bash reviewer.sh healthcheck    → exit 0 if healthy
# =============================================================

set -Eeuo pipefail

# ─── SAFE DEFAULTS ───────────────────────────────────────────
TASK="${AGENT_TASK:-${1:-daemon}}"

# ─── ENVIRONMENT ─────────────────────────────────────────────
KLYN_ROOT="${KLYN_ROOT:-${HOME}/klyn-ai-os}"
AGENT_ID="${AGENT_ID:-reviewer}"
AGENT_LOG_DIR="${AGENT_LOG_DIR:-${KLYN_ROOT}/runtime/logs/agents/${AGENT_ID}}"
AGENT_WORK_DIR="${AGENT_WORK_DIR:-${KLYN_ROOT}/agents/work/${AGENT_ID}}"
KLYN_MAILBOX_DIR="${KLYN_MAILBOX_DIR:-${KLYN_ROOT}/runtime/mailbox}"
KLYN_LOG_LEVEL="${KLYN_LOG_LEVEL:-info}"

LOG_FILE="${AGENT_LOG_DIR}/reviewer.log"
MAILBOX_FILE="${KLYN_MAILBOX_DIR}/kernel.queue"
MY_QUEUE="${KLYN_MAILBOX_DIR}/reviewer.queue"
AUDIT_DIR="${KLYN_ROOT}/runtime/audit"
REVIEW_REPORT="${AUDIT_DIR}/review_$(date +%Y%m%d).md"

DAEMON_POLL_INTERVAL="${REVIEWER_POLL_INTERVAL:-20}"
AGENT_VERSION="2.0.0"

# Quality thresholds
MAX_ALLOWED_TODOS=10
MAX_ALLOWED_CONSOLE_LOGS=5
MIN_QUALITY_SCORE=60    # out of 100

# ─── BOOTSTRAP ───────────────────────────────────────────────
bootstrap() {
    mkdir -p \
        "${AGENT_LOG_DIR}" \
        "${AGENT_WORK_DIR}" \
        "${KLYN_MAILBOX_DIR}" \
        "${AUDIT_DIR}"

    touch "${LOG_FILE}" "${MAILBOX_FILE}" "${MY_QUEUE}"
}

# ─── LOGGING ─────────────────────────────────────────────────
_log() {
    local level="${1}"
    shift
    local ts
    ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "[${ts}] [${AGENT_ID^^}] [${level}] $*" | tee -a "${LOG_FILE}"
}
log_info()  { _log "INFO"  "$@"; }
log_warn()  { _log "WARN"  "$@"; }
log_error() { _log "ERROR" "$@" >&2; }
log_debug() { [[ "${KLYN_LOG_LEVEL}" == "debug" ]] && _log "DEBUG" "$@" || true; }

# ─── MAILBOX ─────────────────────────────────────────────────
mailbox_send() {
    local type="${1}"
    local payload_json="${2:-{}}"
    local priority="${3:-5}"
    local ts_ms
    ts_ms="$(date +%s%3N 2>/dev/null || echo "$(date +%s)000")"
    local uuid
    uuid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null \
        || printf '%08x-%04x' $RANDOM $RANDOM)"

    printf '{"id":"%s","type":"%s","from":"%s","to":"kernel","priority":%d,"ttl":300000,"createdAt":%s,"status":"PENDING","attempts":0,"payload":%s}\n' \
        "${uuid}" "${type}" "${AGENT_ID}" "${priority}" "${ts_ms}" "${payload_json}" \
        >> "${MAILBOX_FILE}" || true
}

# ─── REVIEW ENGINE ───────────────────────────────────────────
review_file() {
    local target_file="${1}"
    local score=100
    local issues=()
    local warnings=()

    log_info "Reviewing: ${target_file}"

    if [[ ! -f "${target_file}" ]]; then
        log_error "Review target not found: ${target_file}"
        return 1
    fi

    local line_count
    line_count="$(wc -l < "${target_file}")"

    # ── Check 1: TODO/FIXME markers ──────────────────────────
    local todo_count=0
    todo_count="$(grep -cnE 'TODO|FIXME|XXX|HACK' "${target_file}" 2>/dev/null || echo 0)"
    if [[ ${todo_count} -gt ${MAX_ALLOWED_TODOS} ]]; then
        local deduction=$(( (todo_count - MAX_ALLOWED_TODOS) * 2 ))
        score=$(( score - deduction ))
        issues+=("HIGH: ${todo_count} TODO/FIXME markers (max: ${MAX_ALLOWED_TODOS})")
    elif [[ ${todo_count} -gt 0 ]]; then
        warnings+=("${todo_count} TODO markers present")
    fi

    # ── Check 2: console.log debug statements ────────────────
    local console_count=0
    console_count="$(grep -cE 'console\.(log|debug)' "${target_file}" 2>/dev/null || echo 0)"
    if [[ ${console_count} -gt ${MAX_ALLOWED_CONSOLE_LOGS} ]]; then
        score=$(( score - 10 ))
        issues+=("MEDIUM: ${console_count} console.log/debug statements")
    fi

    # ── Check 3: 'use strict' present (JS files) ─────────────
    if [[ "${target_file}" == *.js ]]; then
        if ! grep -q "'use strict'" "${target_file}" 2>/dev/null; then
            score=$(( score - 15 ))
            issues+=("HIGH: Missing 'use strict' directive")
        fi

        # Check 4: Error handling (try/catch or .catch())
        local try_count catch_count
        try_count="$(grep -c '\btry\b' "${target_file}" 2>/dev/null || echo 0)"
try_count=$(echo "$try_count" | tr -d "\n")
        catch_count="$(grep -c '\.catch(' "${target_file}" 2>/dev/null || echo 0)"
catch_count=$(echo "$catch_count" | tr -d "\n")
        local error_handling=$(( try_count + catch_count ))

        if [[ ${error_handling} -eq 0 && ${line_count} -gt 50 ]]; then
            score=$(( score - 20 ))
            issues+=("CRITICAL: No error handling found in ${line_count}-line file")
        fi

        # Check 5: eval usage
        local eval_count=0
        eval_count="$(grep -cE '\beval\s*\(' "${target_file}" 2>/dev/null || echo 0)"
        if [[ ${eval_count} -gt 0 ]]; then
            score=$(( score - 25 ))
            issues+=("CRITICAL: ${eval_count} eval() call(s) detected — injection risk")
        fi
    fi

    # ── Check 6: File size sanity ─────────────────────────────
    if [[ ${line_count} -gt 1000 ]]; then
        score=$(( score - 10 ))
        warnings+=("File is ${line_count} lines — consider splitting")
    fi

    # ── Check 7: Shell-specific checks ───────────────────────
    if [[ "${target_file}" == *.sh ]]; then
        if ! grep -q 'set -' "${target_file}" 2>/dev/null; then
            score=$(( score - 20 ))
            issues+=("HIGH: No set -e/u/o pipefail in shell script")
        fi

        # Unquoted variables
        local unquoted=0
        unquoted="$(grep -cE '\$[A-Za-z_][A-Za-z0-9_]*[^}"\x27]' \
            "${target_file}" 2>/dev/null || echo 0)"
        if [[ ${unquoted} -gt 5 ]]; then
            score=$(( score - 10 ))
            warnings+=("${unquoted} potentially unquoted variable expansions")
        fi
    fi

    # Clamp score to [0, 100]
    [[ ${score} -lt 0 ]]   && score=0
    [[ ${score} -gt 100 ]] && score=100

    local ts
    ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

    local grade
    if [[ ${score} -ge 90 ]]; then grade="A"
    elif [[ ${score} -ge 80 ]]; then grade="B"
    elif [[ ${score} -ge 70 ]]; then grade="C"
    elif [[ ${score} -ge 60 ]]; then grade="D"
    else grade="F"
    fi

    # ── Write review report ───────────────────────────────────
    cat >> "${REVIEW_REPORT}" <<EOF

## Code Review — ${ts}
- **File:** \`${target_file}\`
- **Lines:** ${line_count}
- **Score:** ${score}/100 (Grade: ${grade})

### Issues (${#issues[@]})
$(for issue in "${issues[@]:-[none]}"; do echo "- ❌ ${issue}"; done)

### Warnings (${#warnings[@]})
$(for warn in "${warnings[@]:-[none]}"; do echo "- ⚠️  ${warn}"; done)

---
EOF

    log_info "Review complete: score=${score}/100 grade=${grade} issues=${#issues[@]}"

    # Send result to kernel
    local issues_json
    issues_json="$(printf '"%s",' "${issues[@]:-}" | sed 's/,$//')"
    mailbox_send "reviewer:review-complete" \
        "{\"file\":\"${target_file}\",\"score\":${score},\"grade\":\"${grade}\",\"issueCount\":${#issues[@]},\"ts\":\"${ts}\"}" \
        5

    # Alert if quality below threshold
    if [[ ${score} -lt ${MIN_QUALITY_SCORE} ]]; then
        mailbox_send "alert:quality-fail" \
            "{\"file\":\"${target_file}\",\"score\":${score},\"threshold\":${MIN_QUALITY_SCORE},\"grade\":\"${grade}\"}" \
            1
        log_warn "Quality threshold failed: ${score} < ${MIN_QUALITY_SCORE}"
    fi

    return 0
}

# ─── ONE-SHOT REVIEW ─────────────────────────────────────────
run_review_cycle() {
    log_info "Starting review cycle"

    local ts
    ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

    # Write report header
    mkdir -p "${AUDIT_DIR}"
    echo "# KLYN AI OS — Code Review Report" > "${REVIEW_REPORT}"
    echo "Generated: ${ts}" >> "${REVIEW_REPORT}"
    echo "" >> "${REVIEW_REPORT}"

    # Review all kernel JS files
    local reviewed=0
    while IFS= read -r f; do
        review_file "${f}" && reviewed=$(( reviewed + 1 )) || true
    done < <(find "${KLYN_ROOT}/kernel" -maxdepth 1 -name "*.js" 2>/dev/null)

    # Review agents
    while IFS= read -r f; do
        review_file "${f}" && reviewed=$(( reviewed + 1 )) || true
    done < <(find "${KLYN_ROOT}/agents/src" -name "*.sh" 2>/dev/null)

    log_info "Review cycle complete: ${reviewed} file(s) reviewed"
    log_info "Report written: ${REVIEW_REPORT}"

    mailbox_send "reviewer:cycle-complete" \
        "{\"filesReviewed\":${reviewed},\"report\":\"${REVIEW_REPORT}\",\"ts\":\"${ts}\"}" 5
}

# ─── DRAIN QUEUE ─────────────────────────────────────────────
drain_queue() {
    [[ -s "${MY_QUEUE}" ]] || return 0

    local tmp_queue="${MY_QUEUE}.processing.$$"
    mv "${MY_QUEUE}" "${tmp_queue}" 2>/dev/null || return 0
    touch "${MY_QUEUE}"

    local processed=0
    local line

    while IFS= read -r line; do
        [[ -z "${line}" ]] && continue

        local msg_type code_file
        msg_type="$(echo "${line}" | grep -o '"type":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
        code_file="$(echo "${line}" | grep -o '"codeFile":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"

        case "${msg_type}" in
            review-request|reviewer:review)
                if [[ -n "${code_file}" && -f "${code_file}" ]]; then
                    review_file "${code_file}" || log_error "Review failed: ${code_file}"
                else
                    run_review_cycle || log_error "Review cycle failed"
                fi
                processed=$(( processed + 1 ))
                ;;
            *)
                log_debug "Unhandled message: ${msg_type}"
                ;;
        esac
    done < "${tmp_queue}"

    rm -f "${tmp_queue}"
    [[ ${processed} -gt 0 ]] && log_info "Processed ${processed} review request(s)"
    return 0
}

# ─── DAEMON MODE ─────────────────────────────────────────────
run_daemon() {
    log_info "Reviewer Agent starting in daemon mode (poll: ${DAEMON_POLL_INTERVAL}s)"

    mailbox_send "agent:ready" \
        "{\"agentId\":\"${AGENT_ID}\",\"version\":\"${AGENT_VERSION}\",\"mode\":\"daemon\"}" 1

    local cycle=0
    while true; do
        cycle=$(( cycle + 1 ))
        drain_queue || log_warn "Queue drain error on cycle ${cycle}"

        mailbox_send "heartbeat" \
            "{\"agentId\":\"${AGENT_ID}\",\"cycle\":${cycle}}" 10

        sleep "${DAEMON_POLL_INTERVAL}"
    done
}

# ─── STATUS ──────────────────────────────────────────────────
show_status() {
    echo "========================================="
    echo "  KLYN AI OS — Reviewer Agent Status"
    echo "========================================="
    echo "  Agent ID      : ${AGENT_ID}"
    echo "  Version       : ${AGENT_VERSION}"
    echo "  Queue Depth   : $(wc -l < "${MY_QUEUE}" 2>/dev/null || echo 0)"
    echo "  Audit Dir     : ${AUDIT_DIR}"
    echo "  Min Score     : ${MIN_QUALITY_SCORE}/100"
    echo "  Max TODOs     : ${MAX_ALLOWED_TODOS}"
    echo "========================================="
}

# ─── HEALTHCHECK ─────────────────────────────────────────────
do_healthcheck() {
    local ok=true
    [[ -d "${AGENT_LOG_DIR}" ]]    || { echo "FAIL: log dir";     ok=false; }
    [[ -d "${KLYN_MAILBOX_DIR}" ]] || { echo "FAIL: mailbox dir"; ok=false; }
    [[ "${ok}" == "true" ]] && echo "OK: reviewer healthy" && exit 0 || exit 1
}

# ─── TRAP ────────────────────────────────────────────────────
on_exit() {
    local code=$?
    log_info "Reviewer Agent exiting (code: ${code})"
    mailbox_send "agent:exit" "{\"agentId\":\"${AGENT_ID}\",\"exitCode\":${code}}" 5 || true
}
trap on_exit EXIT
trap 'log_info "SIGTERM received"; exit 0' SIGTERM SIGINT

# ─── MAIN ────────────────────────────────────────────────────
main() {
    bootstrap
    log_info "Reviewer Agent v${AGENT_VERSION} — task: ${TASK}"

    case "${TASK}" in
        daemon)             run_daemon ;;
        review)             run_review_cycle ;;
        status)             show_status ;;
        healthcheck|health) do_healthcheck ;;
        *)
            log_warn "Unknown task '${TASK}' — defaulting to daemon"
            run_daemon
            ;;
    esac
}

main
