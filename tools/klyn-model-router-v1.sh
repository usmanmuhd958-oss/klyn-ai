#!/usr/bin/env bash

echo "=============================="
echo " KLYN MODEL ROUTER V1"
echo " INTELLIGENCE SELECTION LAYER"
echo "=============================="

BASE=".klyn/intelligence/model-router"

mkdir -p "$BASE"

cat > "$BASE/router.json" <<EOF
{
  "system":"KLYN Model Router",
  "version":"v1",
  "status":"active",
  "mode":"adaptive-routing"
}
EOF

cat > "$BASE/models.json" <<EOF
{
  "models":[
    {
      "name":"fast-model",
      "purpose":"autocomplete-and-simple-tasks",
      "latency":"low"
    },
    {
      "name":"reasoning-model",
      "purpose":"architecture-and-complex-tasks",
      "latency":"high"
    }
  ]
}
EOF

cat > "$BASE/selection-policy.json" <<EOF
{
  "rules":[
    "simple-task=>fast-model",
    "architecture-task=>reasoning-model",
    "debug-task=>developer-agent",
    "review-task=>reviewer-agent"
  ]
}
EOF

cat > "$BASE/performance-memory.json" <<EOF
{
  "history":[],
  "learning":"enabled"
}
EOF

cat > "$BASE/fallback-chain.json" <<EOF
{
  "primary":"reasoning-model",
  "fallback":"fast-model",
  "failure-recovery":"enabled"
}
EOF

echo "=============================="
echo " MODEL ROUTER READY"
echo "$BASE"
echo "=============================="
