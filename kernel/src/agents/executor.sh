#!/usr/bin/env bash
set -Eeuo pipefail

agent="${1:?agent required}"
queue="runtime/mailbox/${agent}.queue"

mkdir -p runtime/{mailbox,logs}
touch "$queue"

echo "[$(date -Iseconds)] ${agent} started" \
    >> "runtime/logs/${agent}.log"

while true
do
    if [[ -s "$queue" ]]; then
        while read -r task
        do
            echo "[$(date -Iseconds)] task=${task}" \
                >> "runtime/logs/${agent}.log"
        done < "$queue"

        : > "$queue"
    fi

    sleep 1
done
