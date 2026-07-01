#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# ---------------------------
# COLORS
# ---------------------------
RED="\033[1;31m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
CYAN="\033[1;36m"
RESET="\033[0m"

clear_screen() {
  printf "\033[2J\033[H"
}

safe_print() {
  printf "%s\n" "$1"
}

get_system_status() {
  if pgrep -f "scheduler.sh" >/dev/null 2>&1; then
    echo "RUNNING"
  else
    echo "IDLE"
  fi
}

get_active_jobs() {
  local file="runtime/queue/jobs.jsonl"

  if [[ ! -f "$file" ]]; then
    echo "No jobs found"
    return
  fi

  tail -n 5 "$file" 2>/dev/null | jq -r '.id + " | " + .status' 2>/dev/null || tail -n 5 "$file"
}

check_vault_status() {
  local status="OK"

  for f in plan.txt code.txt review.txt; do
    if [[ -f "runtime/vault/$f" ]]; then
      if grep -qi "NO_RESPONSE\|FATAL" "runtime/vault/$f" 2>/dev/null; then
        echo -e "${RED}[ALERT] $f contains FAILURE STATE${RESET}"
        status="ERROR"
      fi
    fi
  done

  echo "$status"
}

check_daemon() {
  if [[ ! -f "runtime/daemon.pid" ]]; then
    echo -e "${RED}[ALERT] daemon.pid missing${RESET}"
    return
  fi

  pid=$(cat runtime/daemon.pid 2>/dev/null || true)

  if [[ -z "$pid" ]]; then
    echo -e "${RED}[ALERT] Empty PID${RESET}"
    return
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${GREEN}Daemon OK (PID $pid)${RESET}"
  else
    echo -e "${RED}[ALERT] Daemon dead (PID $pid)${RESET}"
  fi
}

render_logs() {
  echo -e "${CYAN}--- MODEL ROUTER LOG ---${RESET}"
  tail -n 5 runtime/logs/model_router.log 2>/dev/null || echo "No router logs"

  echo ""
  echo -e "${CYAN}--- KERNEL LOG ---${RESET}"
  tail -n 5 runtime/logs/kernel.log 2>/dev/null || echo "No kernel logs"
}

draw_ui() {
  clear_screen

  echo -e "${CYAN}======================================${RESET}"
  echo -e "${CYAN}        KLYN AI OS MONITOR           ${RESET}"
  echo -e "${CYAN}======================================${RESET}"

  echo ""
  echo -e "${YELLOW}SYSTEM STATUS:${RESET} $(get_system_status)"
  echo ""

  echo -e "${CYAN}ACTIVE JOBS:${RESET}"
  get_active_jobs
  echo ""

  echo -e "${CYAN}AGENT VAULT STATUS:${RESET}"
  check_vault_status
  echo ""

  echo -e "${CYAN}DAEMON STATUS:${RESET}"
  check_daemon
  echo ""

  render_logs

  echo ""
  echo -e "${CYAN}--------------------------------------${RESET}"
  echo "Auto-refresh every 2 seconds (Ctrl+C to exit)"
}

main_loop() {
  while true; do
    draw_ui
    sleep 2
  done
}

main_loop
