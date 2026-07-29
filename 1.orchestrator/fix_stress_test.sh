#!/bin/bash
set -e

node -e '
const fs = require("fs");
let code = fs.readFileSync("stress_test.cjs", "utf8");

// Rewrite Task 2 to collect all task promises and await them before metrics snapshot
if (!code.includes("await Promise.all(taskPromises)")) {
  code = code.replace(
    /for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*TOTAL_TASKS;\s*i\+\+\s*\)\s*\{/g,
    "const taskPromises = [];\n  for (let i = 0; i < TOTAL_TASKS; i++) {"
  );
  
  code = code.replace(
    /orchestrator\.scheduleTask\(([^)]+)\);/g,
    "taskPromises.push(orchestrator.scheduleTask($1));"
  );

  code = code.replace(
    /(const\s+metrics\s*=\s*orchestrator\.getMetrics\(\);)/g,
    "await Promise.all(taskPromises);\n  $1"
  );

  fs.writeFileSync("stress_test.cjs", code);
  console.log("✅ stress_test.cjs successfully updated to await all task promises");
} else {
  console.log("ℹ️ stress_test.cjs is already fully updated");
}
'
