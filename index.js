'use strict';

// Load environment variables before any other module reads them
require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const logger = require('./config/logger');
const { getSupabase } = require('./config/supabase');
const { WORKSPACE_DIR, ensureWorkspace } = require('./config/workspace');

// ---------------------------------------------------------------------------
// Environment validation (fail fast on missing critical vars)
// ---------------------------------------------------------------------------
function validateEnv() {
  const required = ['SUPABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    throw new Error('Either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY must be set');
  }
  logger.info('Environment variables validated');
}

// ---------------------------------------------------------------------------
// Express app + HTTP server + WebSocket server (single port)
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Mount API router
const apiRouter = require('./api/router');
app.use('/api', apiRouter);

// ---------------------------------------------------------------------------
// Workspace file watcher (broadcasts changes to WebSocket clients)
// ---------------------------------------------------------------------------
function startWorkspaceWatcher() {
  const fs = require('fs');
  const watcher = fs.watch(WORKSPACE_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const relativePath = path.relative(WORKSPACE_DIR, path.join(WORKSPACE_DIR, filename));
    let operation = eventType === 'rename' ? 'delete' : 'update';
    const absPath = path.join(WORKSPACE_DIR, filename);
    try {
      if (eventType === 'rename' && fs.existsSync(absPath)) operation = 'create';
    } catch (_) {}
    const msg = JSON.stringify({ event: 'fs:change', path: '/' + relativePath.replace(/\\/g, '/'), operation });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  });
  watcher.on('error', (err) => logger.error({ err }, 'File watcher error'));
  return watcher;
}

// ---------------------------------------------------------------------------
// Orchestrator connection (WebSocket client)
// ---------------------------------------------------------------------------
function connectToOrchestrator() {
  const port = process.env.WS_PORT;
  if (!port) {
    logger.warn('WS_PORT not set; cannot connect to orchestrator');
    return;
  }
  const url = `ws://localhost:${port}`;
  logger.info(`Connecting to orchestrator on port ${port}…`);

  const ws = new WebSocket(url);
  ws.on('open', () => {
    logger.info('Connected to orchestrator');
    ws.send(JSON.stringify({ event: 'app:online', pid: process.pid }));
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      logger.info({ orchestratorMsg: msg }, 'Orchestrator message');
    } catch (_) {}
  });
  ws.on('close', () => {
    logger.warn('Orchestrator connection closed');
  });
  ws.on('error', (err) => {
    logger.error({ err }, 'Orchestrator WebSocket error');
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}. Shutting down…`);

  // Close WebSocket connections
  wss.clients.forEach(client => client.close(1001, 'Server shutting down'));

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Main startup
// ---------------------------------------------------------------------------
async function main() {
  try {
    validateEnv();
    ensureWorkspace();
    getSupabase(); // initialise Supabase (logging only, no crash)

    const watcher = startWorkspaceWatcher();
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
      logger.info(`Klyn AI OS Core listening on port ${PORT}`);
    });

    // Connect to the orchestrator after a small delay to ensure its port is known
    setTimeout(connectToOrchestrator, 1000);

    // Keep the process alive and allow GC if available
    setInterval(() => {
      if (global.gc) global.gc();
    }, 30000);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Klyn AI OS');
    process.exit(1);
  }
}

main();
