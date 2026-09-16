#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN SYSTEM SIGNAL BUS V1"
echo " INTERNAL EVENT COMMUNICATION"
echo "=============================="

DIR=".klyn/runtime/signal-bus"

mkdir -p "$DIR"

cat > "$DIR/bus.json" <<JSON
{
 "name":"klyn-signal-bus",
 "status":"active"
}
JSON

cat > "$DIR/channels.json" <<JSON
{
 "channels":[
  "brain",
  "agents",
  "pipeline",
  "runtime",
  "memory"
 ]
}
JSON

cat > "$DIR/event-schema.json" <<JSON
{
 "events":[
  "task.created",
  "code.generated",
  "review.completed",
  "validation.completed",
  "memory.updated"
 ]
}
JSON

cat > "$DIR/routing-table.json" <<JSON
{
 "routing":"enabled",
 "mode":"event-driven"
}
JSON

cat > "$DIR/signal-history.json" <<JSON
{
 "signals":[],
 "history":[]
}
JSON

echo "=============================="
echo " SIGNAL BUS READY"
echo "$DIR"
echo "=============================="

