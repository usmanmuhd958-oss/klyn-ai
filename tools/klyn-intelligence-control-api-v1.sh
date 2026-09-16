#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN INTELLIGENCE CONTROL API V1"
echo " SYSTEM CONTROL PLANE"
echo "=============================="

DIR=".klyn/api/control-plane"

mkdir -p "$DIR"

cat > "$DIR/controller.json" <<JSON
{
 "name":"klyn-control-plane",
 "status":"active"
}
JSON

cat > "$DIR/routes.json" <<JSON
{
 "routes":[
  "/v1/klyn/status",
  "/v1/agents",
  "/v1/mission"
 ]
}
JSON

cat > "$DIR/permissions.json" <<JSON
{
 "mode":"protected",
 "authentication":"enabled"
}
JSON

cat > "$DIR/runtime-bridge.json" <<JSON
{
 "connects":[
  "master-brain",
  "mission-controller",
  "agent-runtime"
 ]
}
JSON

cat > "$DIR/api-state.json" <<JSON
{
 "online":true,
 "version":"v1"
}
JSON

echo "=============================="
echo " CONTROL API READY"
echo "$DIR"
echo "=============================="

