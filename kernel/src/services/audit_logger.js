const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fsPromises = fs.promises;

const AUDIT_DIR = path.join(__dirname, '..', '..', 'runtime', 'audit_logs');
const CHAIN_FILE = path.join(AUDIT_DIR, 'chain.jsonl');

let lastHashCache = null;
let chainCache = [];

async function initAudit() {
  try {
    await fsPromises.mkdir(AUDIT_DIR, { recursive: true });
    if (!fs.existsSync(CHAIN_FILE)) {
      await fsPromises.writeFile(CHAIN_FILE, '', 'utf8');
    }
  } catch (err) {
    console.error('[Audit] Init error:', err);
  }
}

async function getLastHash() {
  try {
    const content = await fsPromises.readFile(CHAIN_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '0'.repeat(64);
    const last = JSON.parse(lines[lines.length - 1]);
    lastHashCache = last.hash;
    return last.hash;
  } catch (err) {
    console.error('[Audit] getLastHash error:', err);
    return '0'.repeat(64);
  }
}

async function logEvent(action, user, details = {}) {
  await initAudit();
  
  // Sanitize inputs: truncate and escape JSON
  const sanitized = {
    action: String(action).slice(0, 100),
    user: String(user).slice(0, 100),
    details: (() => {
      const d = {};
      for (const [k, v] of Object.entries(details)) {
        d[String(k).slice(0, 50)] = String(v).slice(0, 500);
      }
      return d;
    })()
  };

  const prevHash = lastHashCache || await getLastHash();
  const event = {
    timestamp: new Date().toISOString(),
    action: sanitized.action,
    user: sanitized.user,
    details: sanitized.details,
    prevHash
  };
  
  const hash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  event.hash = hash;
  lastHashCache = hash;

  try {
    await fsPromises.appendFile(CHAIN_FILE, JSON.stringify(event) + '\n', 'utf8');
  } catch (err) {
    console.error('[Audit] logEvent write error:', err);
  }

  return event;
}

async function verifyChain() {
  try {
    const content = await fsPromises.readFile(CHAIN_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    let prevHash = '0'.repeat(64);
    
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.prevHash !== prevHash) return false;
      
      const computedHash = crypto.createHash('sha256').update(JSON.stringify({
        timestamp: event.timestamp,
        action: event.action,
        user: event.user,
        details: event.details,
        prevHash: event.prevHash
      })).digest('hex');
      
      if (computedHash !== event.hash) return false;
      prevHash = event.hash;
    }
    return true;
  } catch (err) {
    console.error('[Audit] verifyChain error:', err);
    return false;
  }
}

async function getRecentEvents(limit = 50) {
  try {
    const content = await fsPromises.readFile(CHAIN_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  } catch (err) {
    console.error('[Audit] getRecentEvents error:', err);
    return [];
  }
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'verify') {
    (async () => {
      const valid = await verifyChain();
      console.log(valid ? 'Audit chain valid' : 'Audit chain tampered!');
    })();
  } else if (cmd === 'log') {
    (async () => {
      await logEvent(process.argv[3], process.argv[4], JSON.parse(process.argv[5] || '{}'));
      console.log('Event logged');
    })();
  } else {
    console.log('Usage: node audit_logger.js [verify|log] ...');
  }
}

module.exports = { logEvent, verifyChain, initAudit, getRecentEvents };
