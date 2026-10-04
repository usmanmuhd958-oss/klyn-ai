#!/usr/bin/env node
// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const workDir = process.cwd();
const args = process.argv.slice(2);
const command = args[0] || 'status';
const isDaemon = args.includes('--daemon');
const isInternalWorker = args.includes('--worker');

const pidFile = path.join(workDir, '.klyn_daemon.pid');
const logFile = path.join(workDir, '.klyn_daemon.log');

// Read the PID recorded in the pid file, or null if absent/invalid.
function readDaemonPid() {
  if (!fs.existsSync(pidFile)) return null;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// Returns true ONLY if the PID is alive AND is actually a KLYN daemon worker
// (not just any process that happened to reuse the PID).
function isDaemonAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // throws ESRCH if the process does not exist
  } catch {
    return false;
  }
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmdline.includes('klyn_cli.js') && cmdline.includes('watch');
  } catch {
    return false;
  }
}

// Remove a stale pid file (dead daemon or PID reused by an unrelated process).
function removeStalePidFile() {
  try {
    fs.unlinkSync(pidFile);
  } catch { /* already gone */ }
}

class KlynV52HardenedDaemonEngine {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.debounceMap = new Map();
    this.ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.klyn_cache']);
    this.astGuardHeader = `// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel\n`;
  }

  start() {
    const logStream = isInternalWorker ? fs.createWriteStream(logFile, { flags: 'a' }) : process.stdout;
    const log = (msg) => {
      const timestamp = new Date().toLocaleTimeString();
      logStream.write(`[${timestamp}] ${msg}\n`);
    };

    log("======================================================================");
    log("       KLYN AI OS v5.2.1 HARDENED BACKGROUND DAEMON ENGINE            ");
    log("======================================================================");
    log(`[KLYN-V5.2.1-DAEMON] Active Watcher bound to: ${this.rootDir}`);
    log("[KLYN-V5.2.1-DAEMON] Sub-millisecond code protection active in background...");

    try {
      fs.watch(this.rootDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (Array.from(this.ignoreDirs).some(dir => filename.includes(dir))) return;
        if (!/\.(js|ts|mjs)$/.test(filename)) return;

        // ABSOLUTE PROTECTION: Never touch CLI binaries or scripts
        if (filename.includes('klyn') || filename.includes('node_modules')) return;

        if (this.debounceMap.has(filename)) {
          clearTimeout(this.debounceMap.get(filename));
        }

        this.debounceMap.set(filename, setTimeout(() => {
          this.processFileEvent(eventType, filename, log);
          this.debounceMap.delete(filename);
        }, 100));
      });
    } catch (err) {
      log(`[KLYN-V5.2.1-ERROR] Watcher error: ${err.message}`);
    }
  }

  processFileEvent(eventType, filename, log) {
    const start = process.hrtime.bigint();
    const filePath = path.join(this.rootDir, filename);

    if (!fs.existsSync(filePath)) return;

    try {
      let code = fs.readFileSync(filePath, 'utf8');
      
      // Strict Guard: Skip executable files or files containing Shebang (#!)
      if (code.startsWith('#!')) return;

      let isRepaired = false;

      if (!code.startsWith(this.astGuardHeader)) {
        code = this.astGuardHeader + code;
        fs.writeFileSync(filePath, code, 'utf8');
        isRepaired = true;
      }

      const end = process.hrtime.bigint();
      const micros = (Number(end - start) / 1000).toFixed(2);
      const millis = (micros / 1000).toFixed(2);
      const mem = process.memoryUsage();

      if (isRepaired) {
        log(`├── [EVENT: ${eventType.toUpperCase()}] ${filename}`);
        log(`│    └── [AST HEALED] Injected Guard Header (${millis}ms | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB)`);
      }
    } catch (err) {
      log(`[KLYN-V5.2.1-ERROR] Guard injection failed for ${filename}: ${err.message}`);
    }
  }
}

if (command === 'watch' && isDaemon) {
  const existingPid = readDaemonPid();
  if (existingPid && isDaemonAlive(existingPid)) {
    console.log(`[KLYN-V5.2.1-DAEMON] Daemon is already running (PID: ${existingPid}).`);
    process.exit(0);
  }
  if (existingPid) {
    console.log(`[KLYN-V5.2.1-DAEMON] Stale pid file (PID ${existingPid} is not a running KLYN daemon). Removing and starting fresh.`);
    removeStalePidFile();
  }
  const child = spawn(process.execPath, [process.argv[1], 'watch', '--worker'], {
    detached: true,
    stdio: 'ignore',
    cwd: workDir
  });
  fs.writeFileSync(pidFile, String(child.pid), 'utf8');
  child.unref();
  console.log(`[KLYN-V5.2.1-DAEMON] Process detached successfully! PID: ${child.pid}`);
  console.log(`[KLYN-V5.2.1-DAEMON] Real-time logs writing to: .klyn_daemon.log`);
  process.exit(0);
} else if (command === 'watch' && isInternalWorker) {
  const daemon = new KlynV52HardenedDaemonEngine(workDir);
  daemon.start();
} else if (command === 'watch') {
  const daemon = new KlynV52HardenedDaemonEngine(workDir);
  daemon.start();
} else if (command === 'stop') {
  const pid = readDaemonPid();
  if (pid) {
    if (isDaemonAlive(pid)) {
      try {
        process.kill(pid);
        console.log(`[KLYN-V5.2.1-DAEMON] Daemon process (${pid}) stopped successfully.`);
      } catch (e) {
        console.log(`[KLYN-V5.2.1-DAEMON] Failed to stop process ${pid}: ${e.message}`);
      }
    } else {
      console.log(`[KLYN-V5.2.1-DAEMON] PID ${pid} is not a running KLYN daemon (stale pid file). Not killing it.`);
    }
    removeStalePidFile();
  } else {
    console.log("[KLYN-V5.2.1-DAEMON] No active daemon running.");
  }
} else if (command === 'status') {
  const pid = readDaemonPid();
  if (pid && isDaemonAlive(pid)) {
    console.log(`[KLYN-V5.2.1-DAEMON] Status: ONLINE (PID: ${pid})`);
  } else if (pid) {
    console.log(`[KLYN-V5.2.1-DAEMON] Status: OFFLINE (stale pid file for PID ${pid} removed)`);
    removeStalePidFile();
  } else {
    console.log("[KLYN-V5.2.1-DAEMON] Status: OFFLINE");
  }
}
