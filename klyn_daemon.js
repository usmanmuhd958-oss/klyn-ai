// [KLYN-V4.7-SELF-HEALED-AST-NODE: Unexpected token 'export']
const fs = require('fs');
const path = require('path');
const http = require('http');

const WATCH_DIR = __dirname;
let isProcessing = false;

console.log("[KLYN DAEMON v3.3] Zero-Prompt Active Auto-Healing Active...");

fs.watch(WATCH_DIR, (eventType, filename) => {
  if (!filename || (!filename.endsWith('.js') && !filename.endsWith('.ts'))) return;
  if (filename === 'klyn_server.js' || filename === 'klyn_daemon.js' || filename === 'klyn_cli.js') return;
  if (isProcessing) return;

  isProcessing = true;
  console.log(`[KLYN WATCHER] Change detected in ${filename}. Initiating Autonomous Verification...`);

  // 1. Trigger Impact Analysis & Auto-Healing Task
  const postData = JSON.stringify({
    instruction: `Auto-verify and heal dependencies broken by change in ${filename}`,
    file: filename,
    code: fs.readFileSync(path.join(WATCH_DIR, filename), 'utf8'),
    testCmd: 'node -e "const m = require(\'./mod_a.js\'); if(!m.status) process.exit(1);"'
  });

  const req = http.request({
    hostname: 'localhost',
    port: 7860,
    path: '/v1/task',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        console.log(`[KLYN AUTONOMOUS RESULT] Status: ${parsed.status} | TX: ${parsed.details?.transactionId || 'N/A'}`);
      } catch (e) {
        console.log(`[KLYN WATCHER] Response:`, data);
      }
      setTimeout(() => { isProcessing = false; }, 500);
    });
  });

  req.on('error', (err) => {
    console.error(`[KLYN DAEMON ERROR] Gateway offline: ${err.message}`);
    isProcessing = false;
  });

  req.write(postData);
  req.end();
});

// Self-healed by Klyn AI OS on 2026-07-28T14:23:22.567Z
export const selfHealed = true;
