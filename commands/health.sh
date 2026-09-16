#!/usr/bin/env bash
set -Eeuo pipefail

export KLYN_ROOT="${KLYN_ROOT:-$HOME/klyn-ai-os}"

cd "$KLYN_ROOT"

[[ -f .env ]] && source .env

source "$KLYN_ROOT/lib/utils/logger.sh"
source "$KLYN_ROOT/lib/service.sh"
source "$KLYN_ROOT/lib/queue.sh"

echo "=== KLYN HEALTH ==="

echo -n "Internet: "
ping -c1 google.com >/dev/null && echo "OK" || echo "FAIL"

echo -n "Supabase DNS: "
if [[ -n "${SUPABASE_URL:-}" ]]; then
    host "$(echo "$SUPABASE_URL" | sed 's#https://##')" >/dev/null \
        && echo "OK" || echo "FAIL"
else
    echo "NOT CONFIGURED"
fi

echo -n "Scheduler: "
status_service scheduler && echo "RUNNING" || echo "STOPPED"

echo -n "Job Queue: "
fetch_jobs >/dev/null 2>&1 && echo "OK" || echo "FAIL"
