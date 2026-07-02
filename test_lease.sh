#!/usr/bin/env bash

set -euo pipefail

KLYN_ROOT="$(pwd)"

source lib/utils/logger.sh
source lib/core/lease_manager.sh

resource="shared_resource"

echo "Starting concurrent lease test..."

(
    acquire_lease "$resource"
    echo "Process 1 acquired lease"
    sleep 5
    release_lease "$resource"
) &

(
    sleep 0.2
    acquire_lease "$resource" || echo "Process 2 blocked (expected)"
) &

wait

echo "Test completed."
