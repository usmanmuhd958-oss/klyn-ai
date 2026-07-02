#!/usr/bin/env bash
KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
LOG_DIR="$KLYN_ROOT/runtime/logs"
LOG_FILE="$LOG_DIR/system.log"
LOCK_FD=200
mkdir -p "$LOG_DIR"
exec {LOCK_FD}>"$LOG_DIR/.log.lock"

RESET="\033[0m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
BLUE="\033[34m"
GRAY="\033[90m"

_get_color() {
    case "$1" in
        INFO)  echo -e "$GREEN" ;;
        WARN)  echo -e "$YELLOW" ;;
        ERROR) echo -e "$RED" ;;
        DEBUG) echo -e "$BLUE" ;;
        *)     echo -e "$GRAY" ;;
    esac
}

_validate_level() {
    case "$1" in
        INFO|WARN|ERROR|DEBUG) return 0 ;;
        *) return 1 ;;
    esac
}

klyn_log() {
    local level="$1"
    local message="$2"
    if [[ -z "$level" || -z "$message" ]]; then
        echo -e "${RED}[LOGGER ERROR] Missing level or message${RESET}"
        return 1
    fi
    if ! _validate_level "$level"; then
        echo -e "${RED}[LOGGER ERROR] Invalid log level: $level${RESET}"
        return 1
    fi
    local pid timestamp formatted color_line file_line
    pid="$$"
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    file_line="${timestamp} | [${level}] | [${pid}] | ${message}"
    color_line="$(_get_color "$level")${file_line}${RESET}"
    {
        flock -x "$LOCK_FD"
        echo "$file_line" >> "$LOG_FILE"
    } 200>"$LOG_FILE.lock"
    echo -e "$color_line"
}
