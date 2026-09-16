#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "=============================="
echo " KLYN TASK INTELLIGENCE V1"
echo " AUTONOMOUS TASK ANALYSIS"
echo "=============================="

DIR=".klyn/runtime/intelligence/task-engine"

mkdir -p "$DIR"

cat > "$DIR/analyzer.json" <<JSON
{
 "engine":"task-analyzer",
 "status":"active"
}
JSON

cat > "$DIR/classifier.json" <<JSON
{
 "types":[
  "bug-fix",
  "feature",
  "refactor",
  "architecture"
 ]
}
JSON

cat > "$DIR/priority.json" <<JSON
{
 "levels":[
  "critical",
  "high",
  "normal",
  "low"
 ]
}
JSON

cat > "$DIR/planning-rules.json" <<JSON
{
 "steps":[
  "analyze",
  "retrieve-context",
  "plan",
  "execute",
  "verify"
 ]
}
JSON

cat > "$DIR/task-memory.json" <<JSON
{
 "history":[]
}
JSON

echo "=============================="
echo " TASK INTELLIGENCE READY"
echo "$DIR"
echo "=============================="

