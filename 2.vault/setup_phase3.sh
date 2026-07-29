#!/usr/bin/env bash

# 1. Create directory structure if it doesn't exist
mkdir -p kernel/src/lifecycle

echo "=========================================="
echo "Starting KLYN AI OS Phase 3 File Creation"
echo "=========================================="

# List of files to create/edit sequentially
files=(
  "kernel/src/lifecycle/agent_parameter_manifest.js"
  "kernel/src/lifecycle/lifecycle_event_bus.js"
  "kernel/src/lifecycle/vault_interface.js"
  "kernel/orchestrator.js"
  "kernel/kernel-entry.js"
  "kernel/src/lifecycle/kernel_state_machine.js"
  "kernel/src/lifecycle/shutdown_coordinator.js"
  "kernel/src/lifecycle/index.js"
)

for file in "${files[@]}"; do
  echo "----------------------------------------"
  echo "Opening: $file"
  echo "Press Enter to open this file in nano, paste Sonnet's code, then Save (Ctrl+O) and Exit (Ctrl+X)."
  read -r
  
  # Ensure directory exists for the file
  mkdir -p "$(dirname "$file")"
  
  # Open in nano
  nano "$file"
  
  echo "Successfully processed $file"
done

echo "=========================================="
echo "All 8 Phase 3 files have been created/updated!"
echo "You can now delete this helper script using: rm setup_phase3.sh"
echo "=========================================="
