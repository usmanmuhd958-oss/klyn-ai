#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN PATH GOVERNANCE V1"
echo " SYSTEM DIRECTORY CONTRACT"
echo "=============================="

mkdir -p .klyn/registry

cat > .klyn/registry/paths.json <<JSON
{
 "brain":{
  "symbolGraph":".klyn/brain/symbol.graph.json",
  "reasoning":".klyn/brain/reasoning-report.json",
  "cognitive":".klyn/brain/cognitive-core",
  "contextRouter":".klyn/brain/context-router"
 },
 "intelligence":{
  "impact":".klyn/impact-map.json"
 },
 "runtime":{
  "agents":".klyn/runtime",
  "eventBus":".klyn/runtime/event-bus",
  "execution":".klyn/runtime/execution",
  "healing":".klyn/runtime/self-healing"
 },
 "platform":{
  "registry":".klyn/platform"
 }
}
JSON

echo "=============================="
echo " PATH GOVERNANCE READY"
echo ".klyn/registry/paths.json"
echo "=============================="

