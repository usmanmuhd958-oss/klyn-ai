#!/bin/bash
set -e

node -e '
const fs = require("fs");
let code = fs.readFileSync("stress_test.cjs", "utf8");

// Ensure task promises are collected and awaited before metrics snapshot
if (!code.includes("Promise.all(tasks)")) {
  code = code.replace(
    /const metrics = orchestrator\.getMetrics\(\);/g,
    "await Promise.all(pendingTasks || []);\n  const metrics = orchestrator.getMetrics();"
  );
  fs.writeFileSync("stress_test.cjs", code);
  console.log("✅ Patched stress_test.cjs to await task completion before metric snapshot");
} else {
  console.log("ℹ️ Already patched");
}
'
