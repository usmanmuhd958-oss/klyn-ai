#!/bin/bash
set -euo pipefail

LOG_FILE="runtime/logs/events.log"

log() {
  local level="$1"
  local module="$2"
  local message="$3"
  local ts

  ts=$(date -Iseconds)

  # stdout (colored)
  case "$level" in
    INFO)  echo -e "\033[1;32m[$ts][$module][$level]\033[0m $message" ;;
    WARN)  echo -e "\033[1;33m[$ts][$module][$level]\033[0m $message" ;;
    ERROR) echo -e "\033[1;31m[$ts][$module][$level]\033[0m $message" ;;
  esac

  mkdir -p runtime/logs

  # json log
  echo "{\"timestamp\":\"$ts\",\"level\":\"$level\",\"module\":\"$module\",\"message\":\"$message\"}" >> "$LOG_FILE"
}
