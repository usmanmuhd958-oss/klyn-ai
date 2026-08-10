#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN AGENT EVENT BRIDGE V1"
echo " EVENT BUS INTEGRATION"
echo "=============================="

DIR=".klyn/runtime/agents/developer"

mkdir -p "$DIR"

cat > "$DIR/event-bindings.json" <<JSON
{
 "inputEvents":[
  "task.created",
  "context.ready"
 ],
 "outputEvents":[
  "plan.created",
  "execution.completed",
  "memory.updated"
 ]
}
JSON

cat > "$DIR/subscriptions.json" <<JSON
{
 "subscriber":"developer-agent",
 "status":"active",
 "bus":"event-bus"
}
JSON

cat > "$DIR/event-log.json" <<JSON
{
 "events":[]
}
JSON

echo "=============================="
echo " EVENT BRIDGE READY"
echo "$DIR"
echo "=============================="

