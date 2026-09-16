#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN CONTEXT ROUTER V1"
echo " INTELLIGENT CONTEXT SELECTION"
echo "=============================="

DIR=".klyn/brain/context-router"

mkdir -p "$DIR"

cat > "$DIR/router-config.json" <<JSON
{
 "engine":"KLYN Context Router",
 "version":"1.0",
 "sources":[
  "symbol.graph.json",
  "impact-map.json",
  "reasoning-report.json",
  "cognitive-core"
 ],
 "mode":"adaptive"
}
JSON

cat > "$DIR/scoring-model.json" <<JSON
{
 "signals":{
  "symbolMatch":0.30,
  "dependency":0.25,
  "impact":0.20,
  "memory":0.15,
  "recency":0.10
 }
}
JSON

cat > "$DIR/context-history.json" <<JSON
{
 "requests":[],
 "selectedFiles":[]
}
JSON

cat > "$DIR/selected-context.json" <<JSON
{
 "context":[],
 "lastUpdate":null
}
JSON

echo "=============================="
echo " CONTEXT ROUTER READY"
echo "$DIR"
echo "=============================="

