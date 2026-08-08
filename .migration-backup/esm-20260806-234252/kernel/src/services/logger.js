/**
 * =============================================================================
 * KLYN AI OS — services/logger.js
 * File: kernel/src/services/logger.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Hash-chained audit logger consumed by the secure API (api/server.js).
 *   Every event is appended to an immutable JSONL chain where each record
 *   references the SHA-256 hash of the previous record, making tampering
 *   detectable via verifyChain().
 *
 * API:
 *   initAudit()            - ensure the audit dir/file exists
 *   logEvent(action,user,details) - append a chained event
 *   verifyChain()          - validate the full chain integrity
 *   getRecentEvents(limit) - read the last N events
 * =============================================================================
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const AUDIT_DIR = process.env.KLYN_AUDIT_DIR || path.join(import.meta.dirname, '..', '..', 'runtime', 'audit_logs');
const CHAIN_FILE = path.join(AUDIT_DIR, 'chain.jsonl');

let lastHashCache = null;

export async function initAudit() {
  await fs.promises.mkdir(AUDIT_DIR, { recursive: true });
  if (!fs.existsSync(CHAIN_FILE)) {
    await fs.promises.writeFile(CHAIN_FILE, '', 'utf8');
  }
}

async function getLastHash() {
  try {
    const content = await fs.promises.readFile(CHAIN_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '0'.repeat(64);
    const last = JSON.parse(lines[lines.length - 1]);
    lastHashCache = last.hash;
    return last.hash;
  } catch (_) {
    return '0'.repeat(64);
  }
}

export async function logEvent(action, user, details = {}) {
  await initAudit();

  // Sanitize inputs: truncate keys/values to bounded lengths
  const sanitized = {
    action: String(action).slice(0, 100),
    user: String(user).slice(0, 100),
    details: (() => {
      const d = {};
      for (const [k, v] of Object.entries(details)) {
        d[String(k).slice(0, 50)] = String(v).slice(0, 500);
      }
      return d;
    })(),
  };

  const prevHash = lastHashCache || (await getLastHash());
  const event = {
    timestamp: new Date().toISOString(),
    action: sanitized.action,
    user: sanitized.user,
    details: sanitized.details,
    prevHash,
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  event.hash = hash;
  lastHashCache = hash;

  await fs.promises.appendFile(CHAIN_FILE, JSON.stringify(event) + '\n', 'utf8');
  return event;
}

export async function verifyChain() {
  try {
    const content = await fs.promises.readFile(CHAIN_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    let prevHash = '0'.repeat(64);

    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.prevHash !== prevHash) return false;

      const computed = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          timestamp: event.timestamp,
          action: event.action,
          user: event.user,
          details: event.details,
          prevHash: event.prevHash,
        }))
        .digest('hex');
      if (computed !== event.hash) return false;
      prevHash = event.hash;
    }
    return true;
  } catch (_) {
    return false;
  }
}

export async function getRecentEvents(limit = 50) {
  try {
    const content = await fs.promises.readFile(CHAIN_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch (_) {
    return [];
  }
}
