#!/usr/bin/env bash
set -Eeuo pipefail

export KLYN_ROOT="${KLYN_ROOT:-$HOME/klyn-ai-os}"

for f in \
    lib/utils/logger.sh \
    lib/pid.sh \
    lib/queue.sh \
    lib/service.sh \
    lib/retry.sh
do
    [[ -f "$KLYN_ROOT/$f" ]] || {
        echo "Missing: $KLYN_ROOT/$f" >&2
        return 1 2>/dev/null || exit 1
    }

    source "$KLYN_ROOT/$f"
done
