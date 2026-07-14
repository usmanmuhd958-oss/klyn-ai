'use strict';
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION -----------------------------------------------------------
const ROOT = '/data/data/com.termux/files/home/klyn-ai-os';
const LOG  = path.join(ROOT, 'runtime', 'logs', 'orchestrator.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

// --- MICROSERVICE DEFINITIONS ------------------------------------------------
const SERVICES = [
  { name: 'Evolution Engine',   script: 'kernel/src/execution/evolution_engine.js',  pid: null },
  { name: 'Cognitive Router',   script: 'kernel/src/routing/cognitive_router.js',   pid: null },
  { name: 'LLM Monitor',        script: 'kernel/src/services/llama_monitor.js',        pid: null },
];

// --- HELPER: check if a PID is alive -----------------------------------------
function isAlive(pid) {
  try { return process.kill(pid, 0); } catch (_) { return false; }
}

// --- HELPER: spawn a microservice --------------------------------------------
function spawnService(svc) {
  const scriptPath = path.join(ROOT, svc.script);
  if (!fs.existsSync(scriptPath)) {
    log(`[WARN] Script not found: ${scriptPath}`);
    return null;
  }
  try {
    const child = exec(`node "${scriptPath}"`, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) log(`[ERROR] ${svc.name} exited with error: ${err.message}`);
    });
    child.unref();
    log(`[OK] Spawned ${svc.name} (PID ${child.pid})`);
    return child.pid;
  } catch (e) {
    log(`[ERROR] Failed to spawn ${svc.name}: ${e.message}`);
    return null;
  }
}

// --- MONITOR & AUTO‑SPAWN ----------------------------------------------------
function healthCheck() {
  SERVICES.forEach(svc => {
    if (svc.pid === null || !isAlive(svc.pid)) {
      svc.pid = spawnService(svc);
    }
  });
}

// Initial spawn
SERVICES.forEach(svc => { svc.pid = spawnService(svc); });

// Periodic check (every 10 seconds)
setInterval(healthCheck, 10000);

// Keep the process alive
setInterval(() => {}, 1000);

log('Kernel Orchestrator (lightweight hub) started – monitoring 3 core services.');
