#!/data/data/com.termux/files/usr/bin/bash
run_scheduler() {
  echo "[DEBUG] Scheduler: Scanning event queue..."
  local tasks=(runtime/queue/*)
  if [ -e "${tasks[0]}" ]; then
    for task in "${tasks[@]}"; do
      echo "[DEBUG] Scheduler: Dispatching execution for $(basename "$task")"
      rm -f "$task"
    done
  fi
}
