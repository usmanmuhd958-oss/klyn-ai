#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// 1. Load environment variables FIRST (optional dependency)
// ---------------------------------------------------------------------------
try {
  require('dotenv').config();
} catch {
  // dotenv is optional — proceed without it.
}

// ---------------------------------------------------------------------------
// 2. Imports
// ---------------------------------------------------------------------------
import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 3. Simple structured logger (no external deps)
// ---------------------------------------------------------------------------
const LOG_LEVELS: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase() ?? ''] ?? LOG_LEVELS.INFO;

const COLORS: Record<string, string> = {
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m',
};

function log(level: string, message: string, meta?: any): void {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const color = level === 'INFO' ? COLORS.green : level === 'WARN' ? COLORS.yellow : level === 'ERROR' || level === 'FATAL' ? COLORS.red : COLORS.cyan;
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.log(`${color}[Orchestrator] [${level}] ${timestamp} ${message}${metaStr}${COLORS.reset}`);
  if (level === 'FATAL') process.exit(1);
}

// Optional: where to write the runtime port (for index.js to read)
const RUNTIME_PORT_FILE = path.join(import.meta.dirname, '..', '.runtime-port.json');

// ---------------------------------------------------------------------------
// 4. Resolve + validate the WS port (must be 1024–65535)
// ---------------------------------------------------------------------------
function resolveWsPort(): number {
  const raw = process.env.WS_PORT;
  const port = parseInt(raw ?? '', 10);
  if (!raw || isNaN(port) || port < 1024 || port > 65535) {
    log('FATAL', `WS_PORT must be a valid port number (1024–65535). Got: "${raw}"`);
  }
  return port;
}

// ---------------------------------------------------------------------------
// 5. Create WebSocket server (ws is an optional dependency, loaded lazily so
//    importing this module never crashes when ws is not installed)
// ---------------------------------------------------------------------------
function createWSServer(port: number): Promise<any> {
  let WebSocket: any;
  try {
    WebSocket = require('ws');
  } catch {
    return Promise.reject(new Error('Optional dependency "ws" is not installed. Run `npm install ws` to enable the IPC WebSocket server.'));
  }

  return new Promise((resolve, reject) => {
    const wss = new WebSocket.Server({ port });

    wss.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Please free it or set another WS_PORT.`));
      } else {
        reject(err);
      }
    });

    wss.on('listening', () => {
      log('INFO', `Core IPC WebSocket server bound to port ${port}`);
      writeRuntimePort(port);
      resolve(wss);
    });

    wss.on('connection', (ws: any) => {
      log('INFO', 'New IPC connection established');
      ws.send(JSON.stringify({ event: 'orchestrator:connected', timestamp: new Date().toISOString() }));
      ws.on('close', () => log('INFO', 'IPC connection closed'));
      ws.on('error', (err: any) => log('ERROR', `IPC connection error: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// 6. Write active port to runtime file (so index.js can discover it)
// ---------------------------------------------------------------------------
function writeRuntimePort(port: number): void {
  try {
    fs.writeFileSync(RUNTIME_PORT_FILE, JSON.stringify({ activeWsPort: port, updatedAt: new Date().toISOString() }));
    log('INFO', `Runtime port file updated → ${RUNTIME_PORT_FILE}`);
  } catch (err: any) {
    log('ERROR', `Failed to write runtime port file: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Spawn index.js – output goes straight to the terminal
// ---------------------------------------------------------------------------
function startApplication(): void {
  const appScript = path.join(import.meta.dirname, '..', 'index.js');
  if (!fs.existsSync(appScript)) {
    log('WARN', `index.js not found at ${appScript}. Orchestrator running without app.`);
    return;
  }
  const WS_PORT = resolveWsPort();
  log('INFO', `Launching application (index.js) with WS port ${WS_PORT}…`);
  const child = fork(appScript, [], {
    stdio: 'inherit',
    env: { ...process.env, WS_PORT: String(WS_PORT) },
  });
  child.on('exit', (code) => {
    log('INFO', `Application exited with code ${code}`);
  });
}

// ---------------------------------------------------------------------------
// 8. Graceful shutdown
// ---------------------------------------------------------------------------
function gracefulShutdown(signal: string, wss: any): void {
  log('INFO', `Received ${signal}. Shutting down…`);
  wss.clients.forEach((client: any) => client.close(1001, 'Server shutting down'));
  wss.close(() => {
    log('INFO', 'WebSocket server closed');
    process.exit(0);
  });
  setTimeout(() => {
    log('ERROR', 'Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

// ---------------------------------------------------------------------------
// 9. Orchestrator class — the API consumed by kernel-entry.ts
// ---------------------------------------------------------------------------
export class Orchestrator {
  private readonly _manifest: any;
  private _wss: any = null;

  constructor(manifest: any) {
    this._manifest = manifest;
  }

  async start(): Promise<{ port: number }> {
    const port = resolveWsPort();
    log('INFO', 'Klyn AI OS Orchestrator starting…');
    const wss = await createWSServer(port);
    this._wss = wss;

    process.on('SIGINT', () => gracefulShutdown('SIGINT', wss));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', wss));

    startApplication();

    setInterval(() => {
      if (global.gc) {
        const mem = process.memoryUsage();
        if (mem.heapUsed > 150 * 1024 * 1024) {
          log('WARN', `Heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB > 150MB → forcing GC`);
          global.gc();
        }
      }
    }, 30000);

    return { port };
  }
}

// ---------------------------------------------------------------------------
// 10. Standalone entry point (only when executed directly)
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  log('INFO', 'Klyn AI OS Orchestrator (standalone) starting…');
  try {
    const port = resolveWsPort();
    const wss = await createWSServer(port);

    process.on('SIGINT', () => gracefulShutdown('SIGINT', wss));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', wss));

    startApplication();
  } catch (err: any) {
    log('FATAL', `Failed to start orchestrator: ${err.message}`, { stack: err.stack });
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main();
}
