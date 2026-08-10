#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN AGENT EXECUTION LOOP V1"
echo " AUTONOMOUS TASK CYCLE"
echo "=============================="

DIR=".klyn/runtime/agents/developer"

mkdir -p "$DIR"

cat > "$DIR/loop.json" <<JSON
{
 "loop":"active",
 "stages":[
  "receive",
  "context",
  "plan",
  "execute",
  "verify",
  "learn"
 ]
}
JSON

cat > "$DIR/state.json" <<JSON
{
 "status":"idle",
 "currentTask":null,
 "lastAction":null
}
JSON

cat > "$DIR/queue.json" <<JSON
{
 "pending":[]
}
JSON

cat > "$DIR/execution-history.json" <<JSON
{
 "executions":[]
}
JSON

echo "=============================="
echo " AGENT LOOP READY"
echo "$DIR"
echo "=============================="

