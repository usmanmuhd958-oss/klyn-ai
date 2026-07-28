#!/bin/bash

echo "=== 1. TESTING TASK EXECUTION WITH AUTONOMOUS GIT COMMIT ==="
curl -s -X POST http://localhost:7860/v1/task \
  -H "Content-Type: application/json" \
  -d @- << 'PAYLOAD'
{
  "instruction": "Autonomous Git Commit Verification",
  "file": "mod_a.js",
  "code": "export default { status: \"v4.3_git_commit_verified\" };",
  "testCmd": "node -e \"import('./mod_a.js').then(m => { if (m.default.status !== 'v4.3_git_commit_verified') process.exit(1); });\""
}
PAYLOAD
echo ""

echo "=== 2. CHECKING LATEST AUTONOMOUS GIT COMMIT ==="
git log -1 --oneline

echo "=== 3. QUERYING KLYN TELEMETRY LOGS ==="
klyn logs
