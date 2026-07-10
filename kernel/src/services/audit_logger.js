const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIT_DIR = path.join(__dirname, '..', '..', 'runtime', 'audit_logs');
const CHAIN_FILE = path.join(AUDIT_DIR, 'chain.jsonl');

function initAudit() {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  if (!fs.existsSync(CHAIN_FILE)) fs.writeFileSync(CHAIN_FILE, '');
}

function getLastHash() {
  const lines = fs.readFileSync(CHAIN_FILE, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return '0'.repeat(64);
  return JSON.parse(lines[lines.length - 1]).hash;
}

function logEvent(action, user, details = {}) {
  initAudit();
  const prevHash = getLastHash();
  const event = {
    timestamp: new Date().toISOString(),
    action,
    user,
    details,
    prevHash
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
  event.hash = hash;
  fs.appendFileSync(CHAIN_FILE, JSON.stringify(event) + '\n');
  return event;
}

function verifyChain() {
  const lines = fs.readFileSync(CHAIN_FILE, 'utf8').trim().split('\n').filter(Boolean);
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
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'verify') {
    console.log(verifyChain() ? 'Audit chain valid' : 'Audit chain tampered!');
  } else if (cmd === 'log') {
    logEvent(process.argv[3], process.argv[4], JSON.parse(process.argv[5] || '{}'));
    console.log('Event logged');
  } else {
    console.log('Usage: node audit_logger.js [verify|log] ...');
  }
}

module.exports = { logEvent, verifyChain };
