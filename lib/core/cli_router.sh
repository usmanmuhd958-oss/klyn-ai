#!/usr/bin/env bash

# =============================================================================
# KLYN AI OS - CLI Router (lib/core/cli_router.sh)
# -----------------------------------------------------------------------------
# PURPOSE:
# This module provides a centralized command routing system for KLYN AI OS.
# It decouples CLI parsing from execution logic, enabling scalable command
# registration and modular expansion.
#
# DESIGN GOALS:
# - Centralized command dispatch (single routing authority)
# - Clean separation between CLI and business logic
# - Extensible case-based command registry
# - Integrated logging for observability
# - Graceful handling of unknown commands
#
# DEPENDENCIES:
# - lib/utils/logger.sh
# =============================================================================

set -euo pipefail

KLYN_ROOT="${KLYN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# shellcheck source=/dev/null
source "$KLYN_ROOT/lib/utils/logger.sh"

# -----------------------------------------------------------------------------
# COMMAND REGISTRY (single source of truth)
# -----------------------------------------------------------------------------
print_help() {
    cat <<EOF

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

