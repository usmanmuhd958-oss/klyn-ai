#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN REAL-TIME INTELLIGENCE GATEWAY V1"
echo " LIVE SYSTEM COMMUNICATION"
echo "=============================="

DIR=".klyn/api/realtime-gateway"

mkdir -p "$DIR"

cat > "$DIR/gateway.json" <<JSON
{
 "system":"realtime-gateway",
 "status":"active"
}
JSON

cat > "$DIR/websocket.json" <<JSON
{
 "protocol":"websocket",
 "mode":"streaming"
}
JSON

cat > "$DIR/sessions.json" <<JSON
{
 "sessions":[],
 "persistence":"enabled"
}
JSON

cat > "$DIR/event-stream.json" <<JSON
{
 "events":[],
 "source":"klyn-runtime"
}
JSON

cat > "$DIR/connection-policy.json" <<JSON
{
 "authentication":"required",
 "channels":[
  "brain",
  "agents",
  "runtime"
 ]
}
JSON

echo "=============================="
echo " REAL-TIME GATEWAY READY"
echo "$DIR"
echo "=============================="

