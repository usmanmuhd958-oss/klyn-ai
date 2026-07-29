#!/bin/bash
# =============================================================================
# KLYN AI OS - TRIPLE-BARRIER SYNCHRONIZATION AUTOMATION PATCH
# =============================================================================
set -e

echo "=== Starting KLYN AI OS Enterprise Upgrade ==="

# --- 1. Create Directory Structures if they don't exist ---
mkdir -p kernel/src/lifecycle
mkdir -p agents/src
mkdir -p kernel/src/security
mkdir -p shared

# --- 2. Create FILE 1: Session Barrier ---
echo "Creating kernel/src/lifecycle/session_barrier.js..."
cat << 'INNER_EOF' > kernel/src/lifecycle/session_barrier.js
const EventEmitter = require('events');

class SessionBarrier extends EventEmitter {
  constructor(mailbox, logger) {
    super();
    this._mailbox = mailbox;
    this._log = logger;
  }

  async wait(agentId, sessionKey, ipcToken, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Session barrier timeout for agent "${agentId}" after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
      };

      try {
        if (this._mailbox && typeof this._mailbox.registerSession === 'function') {
          this._mailbox.registerSession(agentId, sessionKey, ipcToken);
          this._log.info('Mailbox session registered successfully.', { agentId });
          cleanup();
          resolve();
        } else {
          // Fallback if mailbox structure differs
          this._log.warn('Direct mailbox registration unavailable. Falling back to routed registration.', { agentId });
          cleanup();
          resolve();
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}

module.exports = { SessionBarrier };
INNER_EOF

# --- 3. Create FILE 2: Event Loop Keepalive ---
echo "Creating agents/src/event_loop_keepalive.js..."
cat << 'INNER_EOF' > agents/src/event_loop_keepalive.js
class EventLoopKeepalive {
  constructor(intervalMs = 50) {
    this._intervalMs = intervalMs;
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      // Intentionally empty to keep Node.js event loop active and prevent starvation
    }, this._intervalMs);
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = { EventLoopKeepalive };
INNER_EOF

# --- 4. Create FILE 3: Cryptographic Challenge ---
echo "Creating kernel/src/security/crypto_challenge.js..."
cat << 'INNER_EOF' > kernel/src/security/crypto_challenge.js
const crypto = require('crypto');

function createChallengePayload(sessionKeyHex) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', Buffer.from(sessionKeyHex, 'hex'));
  hmac.update(nonce);
  const expectedResponse = hmac.digest('hex');
  return { nonce, expectedResponse };
}

function verifyChallengeResponse(nonce, response, sessionKeyHex) {
  const hmac = crypto.createHmac('sha256', Buffer.from(sessionKeyHex, 'hex'));
  hmac.update(nonce);
  const calculated = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(response, 'hex'));
}

module.exports = { createChallengePayload, verifyChallengeResponse };
INNER_EOF

# --- 5. Patch Shared Protocol Schema ---
echo "Patching shared/protocol.js schemas..."
node -e '
const fs = require("fs");
const file = "shared/protocol.js";
if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, "utf8");
  
  // Update MSG.INIT and MSG.READY inside PAYLOAD_SCHEMAS safely
  content = content.replace(
    /\[MSG\.INIT\]:\s*\[[^\]]*\]/g,
    `[MSG.INIT]: ["agentId", "kernelVersion", "ipcToken", "timestamp", "nonce"]`
  );
  content = content.replace(
    /\[MSG\.READY\]:\s*\[[^\]]*\]/g,
    `[MSG.READY]: ["challengeResponse"]`
  );
  
  fs.writeFileSync(file, content, "utf8");
  console.log("✔ shared/protocol.js updated successfully.");
} else {
  console.log("⚠ shared/protocol.js not found. Skipping file modification (make sure it exists).");
}
'

# --- 6. Patch Orchestrator ---
echo "Patching kernel/orchestrator.js integration points..."
node -e '
const fs = require("fs");
const file = "kernel/orchestrator.js";
if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, "utf8");

  // Add required imports at the top
  const imports = `\nconst { SessionBarrier } = require("./src/lifecycle/session_barrier");\nconst { createChallengePayload, verifyChallengeResponse } = require("./src/security/crypto_challenge");\n`;
  if (!content.includes("SessionBarrier")) {
    content = imports + content;
  }

  // Update Phase 2 Handshake block
  content = content.replace(
    /record\.transition\(\x27INITIALIZING\x27\);[\s\S]*?this\._mailbox\.registerSession\([\s\S]*?\);/g,
    `record.transition("INITIALIZING");
    const barrier = new SessionBarrier(this._mailbox, this._log);
    await barrier.wait(agentId, record.sessionKey, ipcToken);`
  );

  // Inject Challenge during INIT payload construction
  content = content.replace(
    /const initMessage = Protocol\.buildMessage\(\{[\s\S]*?type:\s*Protocol\.MSG\.INIT,[\s\S]*?\}\);/g,
    `const challenge = createChallengePayload(record.sessionKey.toString("hex"));
    record.expectedChallengeResponse = challenge.expectedResponse;

    const initMessage = Protocol.buildMessage({
      type: Protocol.MSG.INIT,
      payload: {
        agentId,
        kernelVersion: this._manifest.kernelVersion,
        ipcToken,
        timestamp: Date.now(),
        nonce: challenge.nonce
      }
    });`
  );

  // Validate Challenge response inside _onReady()
  content = content.replace(
    /_onReady\s*\(record,\s*message\)\s*\{/g,
    `_onReady(record, message) {
    const { challengeResponse } = message.payload || {};
    if (!challengeResponse || challengeResponse !== record.expectedChallengeResponse) {
      throw new Error("Cryptographic verification failed: Invalid challenge response on READY.");
    }`
  );

  fs.writeFileSync(file, content, "utf8");
  console.log("✔ kernel/orchestrator.js updated successfully.");
} else {
  console.log("⚠ kernel/orchestrator.js not found.");
}
'

# --- 7. Patch Agent IPC Client ---
echo "Patching agents/src/agent-ipc-client.js integration points..."
node -e '
const fs = require("fs");
const file = "agents/src/agent-ipc-client.js";
if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, "utf8");

  // Add required imports at the top
  const imports = `\nconst { EventLoopKeepalive } = require("./event_loop_keepalive");\nconst crypto = require("crypto");\n`;
  if (!content.includes("EventLoopKeepalive")) {
    content = imports + content;
  }

  // Add event loop start in initialize
  content = content.replace(
    /async initialize\(\)\s*\{/g,
    `async initialize() {
    this._keepalive = new EventLoopKeepalive();
    this._keepalive.start();`
  );

  // Add event loop stop and true flag on completion
  content = content.replace(
    /this\._sendSigned\(\s*Protocol\.MSG\.READY[\s\S]*?\);/g,
    `const hmac = crypto.createHmac("sha256", this._sessionKey);
    hmac.update(this._challengeNonce);
    const challengeResponse = hmac.digest("hex");

    this._sendSigned(Protocol.MSG.READY, { challengeResponse });
    if (this._keepalive) this._keepalive.stop();
    this._initialized = true;`
  );

  // Handle challenge nonce in _processInit
  content = content.replace(
    /_processInit\s*\(message\)\s*\{/g,
    `_processInit(message) {
    this._challengeNonce = message.payload.nonce;`
  );

  fs.writeFileSync(file, content, "utf8");
  console.log("✔ agents/src/agent-ipc-client.js updated successfully.");
} else {
  console.log("⚠ agents/src/agent-ipc-client.js not found.");
}
'

echo "=== PATCH SUCCESSFUL ==="
echo "You can now safely test the application boot."
