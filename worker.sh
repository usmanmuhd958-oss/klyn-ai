#!/usr/bin/env bash

# Point to the location of lease_manager.sh
source "$HOME/klyn-ai-os/kernel/v6/utils/lease_manager.sh"

export KLYN_LEASE_ROOT="$HOME/klyn-ai-os/runtime/leases"

# Run the test
if T=$(lease_acquire "shared.resource" 10 0 "worker-$1" 2>>"$HOME/klyn-ai-os/runtime/logs/race.log"); then
    echo "$1 WON $T" >> "$HOME/klyn-ai-os/runtime/results.txt"
fi
