'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Log directory is env-overridable; defaults to a portable home-dir location
// (previously hardcoded to a Termux-only path).
const LOG_DIR = process.env.KLYN_LOG_DIR || path.join(os.homedir(), '.klyn', 'runtime', 'logs');

function writeLine(level, name, message, meta?) {
  const line = `[${level}][${name}] ${message} ${meta ? JSON.stringify(meta) : ''}`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `${name}.log`), line + '\n');
  } catch (_) {
    // Logging must never crash the caller.
  }
}

export function createLogger(name) {
  return {
    info:     (m, meta?) => writeLine('INFO', name, m, meta),
    error:    (m, meta?) => writeLine('ERROR', name, m, meta),
    warn:     (m, meta?) => writeLine('WARN', name, m, meta),
    debug:    (m, meta?) => writeLine('DEBUG', name, m, meta),
    security: (m, meta?) => writeLine('SECURITY', name, m, meta),
  };
}

export function generateCorrelationId() {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
