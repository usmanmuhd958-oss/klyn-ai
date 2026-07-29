#!/usr/bin/env bash
set -Eeuo pipefail

export KLYN_ROOT="${KLYN_ROOT:-$HOME/klyn-ai-os}"

source "$KLYN_ROOT/lib/utils/logger.sh"

print_help() {
cat <<HELP

KLYN AI OS - Command Reference

USAGE:
  klyn <command> [args]

CORE COMMANDS:
  start       Boot kernel system
  stop        Shutdown kernel processes
  status      Show system health
  logs        View system logs
  help        Show this help menu

SYSTEM INFO:
  CLI Router Version: v1.0
  Architecture: Modular Kernel Dispatch Layer

HELP
}

route() {
    local cmd="${1:-help}"

    case "$cmd" in
        help) print_help ;;
        *) echo "Unknown command: $cmd" ;;
    esac
}
