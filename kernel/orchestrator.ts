#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// 1. Load environment variables FIRST
// ---------------------------------------------------------------------------
require('dotenv').config();

// ---------------------------------------------------------------------------
// 2. Imports
// ---------------------------------------------------------------------------
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// ---------------------------------------------------------------------------
// 3. Simple structured logger (no external deps)
// ---------------------------------------------------------------------------
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

const COLORS = {
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m',
};

function log(level, message, meta) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const color = level === 'INFO' ? COLORS.green : level === 'WARN' ? COLORS.yellow : level === 'ERROR' || level === 'FATAL' ? COLORS.red : COLORS.cyan;
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.log(`${color}[Orchestrator] [${level}] ${timestamp} ${message}${metaStr}${COLORS.reset}`);
  if (level === 'FATAL') process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Validate critical environment variables
// ---------------------------------------------------------------------------
if (!process.env.WS_PORT) {
  // @ts-ignore
  log('FATAL', 'WS_PORT environment variable is not set. Please define it in .env or export it before starting.');
}

const WS_PORT = parseInt(process.env.WS_PORT, 10);
if (isNaN(WS_PORT) || WS_PORT < 1024 || WS_PORT > 65535) {
  // @ts-ignore
  log('FATAL', `WS_PORT must be a valid port number (1024–65535). Got: "${process.env.WS_PORT}"`);
}

// Optional: where to write the runtime port (for index.js to read)
const RUNTIME_PORT_FILE = path.join(__dirname, '..', '.runtime-port.json');

// ---------------------------------------------------------------------------
// 5. Create WebSocket server with robust error handling + connection listener
// ---------------------------------------------------------------------------
function createWSServer(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocket.Server({ port });

    // Synchronous error during construction? Unlikely but safe.
    wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Please free it or set another WS_PORT.`));
      } else {
        reject(err);
      }
    });

    wss.on('listening', () => {
      // @ts-ignore
      log('INFO', `Core IPC WebSocket server bound to port ${port}`);
      // Write the active port so index.js can discover it
      writeRuntimePort(port);
      resolve(wss);
    });

    // Log every new IPC connection (e.g., from index.js)
    wss.on('connection', (ws) => {
      // @ts-ignore
      log('INFO', `New IPC connection established`);
      ws.send(JSON.stringify({ event: 'orchestrator:connected', timestamp: new Date().toISOString() }));
      // @ts-ignore
      ws.on('close', () => log('INFO', 'IPC connection closed'));
      // @ts-ignore
      ws.on('error', (err) => log('ERROR', `IPC connection error: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// 6. Write active port to runtime file (so index.js can discover it)
// ---------------------------------------------------------------------------
function writeRuntimePort(port) {
  try {
    fs.writeFileSync(RUNTIME_PORT_FILE, JSON.stringify({ activeWsPort: port, updatedAt: new Date().toISOString() }));
    // @ts-ignore
    log('INFO', `Runtime port file updated → ${RUNTIME_PORT_FILE}`);
  } catch (err) {
    // @ts-ignore
    log('ERROR', `Failed to write runtime port file: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Spawn index.js – output is NOT swallowed; it goes directly to Termux
// ---------------------------------------------------------------------------
function startApplication() {
  const appScript = path.join(__dirname, '..', 'index.js');
  if (!fs.existsSync(appScript)) {
    // @ts-ignore
    log('WARN', `index.js not found at ${appScript}. Orchestrator running without app.`);
    return;
  }
  // @ts-ignore
  log('INFO', `Launching application (index.js) with WS port ${WS_PORT}…`);
  const child = fork(appScript, [], {
    stdio: 'inherit',           // <-- FIX: all output visible in Termux
    env: { ...process.env, WS_PORT: String(WS_PORT) },
  });
  child.on('exit', (code) => {
    // @ts-ignore
    log('INFO', `Application exited with code ${code}`);
  });
}

// ---------------------------------------------------------------------------
// 8. Graceful shutdown
// ---------------------------------------------------------------------------
function gracefulShutdown(signal, wss) {
  // @ts-ignore
  log('INFO', `Received ${signal}. Shutting down…`);
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));
  wss.close(() => {
    // @ts-ignore
    log('INFO', 'WebSocket server closed');
    process.exit(0);
  });
  setTimeout(() => {
    // @ts-ignore
    log('ERROR', 'Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

// ---------------------------------------------------------------------------
// 9. Main entry point
// ---------------------------------------------------------------------------
(async function main() {
  // @ts-ignore
  log('INFO', 'Klyn AI OS Orchestrator starting…');
  try {
    const wss = await createWSServer(WS_PORT);

    // Graceful shutdown hooks
    process.on('SIGINT', () => gracefulShutdown('SIGINT', wss));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', wss));

    // Optionally launch the main application
    startApplication();

    // Keep the process alive and manage memory
    setInterval(() => {
      if (global.gc) {
        const mem = process.memoryUsage();
        if (mem.heapUsed > 150 * 1024 * 1024) {
          // @ts-ignore
          log('WARN', `Heap ${Math.round(mem.heapUsed/1024/1024)}MB > 150MB → forcing GC`);
          global.gc();
        }
      }
    }, 30000);
  } catch (err) {
    log('FATAL', `Failed to start orchestrator: ${err.message}`, { stack: err.stack });
  }
})();
