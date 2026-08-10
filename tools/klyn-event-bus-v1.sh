#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN EVENT BUS V1"
echo " SYSTEM COMMUNICATION LAYER"
echo "=============================="

DIR=".klyn/runtime/event-bus"

mkdir -p "$DIR"

cat > "$DIR/bus-config.json" <<JSON
{
 "engine":"KLYN Event Bus",
 "version":"1.0",
 "mode":"event-driven",
 "maxHistory":1000
}
JSON

cat > "$DIR/events.json" <<JSON
{
 "events":[
  "TASK_CREATED",
  "TASK_STARTED",
  "TASK_COMPLETED",
  "CONTEXT_UPDATED",
  "MEMORY_LEARNED",
  "ERROR_DETECTED"
 ]
}
JSON

cat > "$DIR/subscriptions.json" <<JSON
{
 "subscriptions":[
  {
   "event":"TASK_CREATED",
   "agents":[
    "planner-agent"
   ]
  },
  {
   "event":"ERROR_DETECTED",
   "agents":[
    "verify-agent",
    "self-healing-agent"
   ]
  }
 ]
}
JSON

cat > "$DIR/event-history.json" <<JSON
{
 "history":[]
}
JSON

echo "=============================="
echo " EVENT BUS READY"
echo "$DIR"
echo "=============================="

