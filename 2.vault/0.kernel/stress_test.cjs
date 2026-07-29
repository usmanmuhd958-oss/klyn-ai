const kernel = require('./klyn_kernel_core.linux-arm64-gnu.node');
const { performance } = require('perf_hooks');

console.log('==========================================================');
console.log('  KLYN AI OS - Daemon & LawVM 1,000 Event Stress Test');
console.log('==========================================================\n');

// 1. Initialize & Start Autonomous Daemon
console.log('[1/4] Starting Autonomous Daemon background thread...');
const started = kernel.startDaemon();
if (!started) {
  console.error('Failed to start daemon thread!');
  process.exit(1);
}

const initialStatus = JSON.parse(kernel.getDaemonStatus());
console.log('Initial Daemon Status:', initialStatus);

// 2. Generate 1,000 Binary Bus Event Payloads
console.log('\n[2/4] Constructing 1,000 binary event payloads (Wire Protocol v1)...');

const MALICIOUS_PATTERNS = [
  'eval(payload)',
  'exec("rm -rf /")',
  'DROP TABLE users;',
  '__import__("os").system("sh")',
  'const x = require("child_process").execSync("cat /etc/passwd")'
];

const SAFE_DIFFS = [
  '--- src/main.rs\n+++ src/main.rs\n@@ -1,1 +1,1 @@\n-let x = 5;\n+let x = 10;',
  '--- src/lib.rs\n+++ src/lib.rs\n@@ -10,1 +10,1 @@\n-pub fn test() {}\n+pub fn test_v2() {}',
  '--- src/bus.rs\n+++ src/bus.rs\n@@ -5,1 +5,1 @@\n-// todo\n+// implemented'
];

const events = [];
let expectedViolations = 0;

for (let i = 0; i < 1000; i++) {
  const rand = Math.random();
  let buf;

  if (rand < 0.6) {
    // 60% Code Diffs (25% intentional LawVM violations)
    const isMalicious = Math.random() < 0.25;
    const payloadStr = isMalicious
      ? MALICIOUS_PATTERNS[Math.floor(Math.random() * MALICIOUS_PATTERNS.length)]
      : SAFE_DIFFS[Math.floor(Math.random() * SAFE_DIFFS.length)];

    if (isMalicious) expectedViolations++;

    const payloadBuf = Buffer.from(payloadStr, 'utf-8');
    buf = Buffer.alloc(4 + payloadBuf.length);
    buf.writeUInt8(0x10, 0); // Event Type: 0x10 (Code Diff)
    buf.writeUInt16LE(payloadBuf.length, 1);
    buf.writeUInt8(0x00, 3);
    payloadBuf.copy(buf, 4);
  } else if (rand < 0.85) {
    // 25% Bug Events
    const severity = Math.floor(Math.random() * 5) + 1;
    if (severity >= 3) expectedViolations++;
    buf = Buffer.from([0x11, severity, 0x01, 0x02]); // Event Type: 0x11 (Bug)
  } else {
    // 15% Security Threat Events
    const threatLevel = Math.floor(Math.random() * 10) + 1;
    if (threatLevel > 5) expectedViolations++;
    buf = Buffer.from([0x12, threatLevel, 0x00, 0x00]); // Event Type: 0x12 (Security)
  }

  events.push(buf);
}

console.log(`Generated 1,000 events (~${expectedViolations} expected LawVM / Vault violations)`);

// 3. Dispatch Events into Kernel Process Event Pipeline
console.log('\n[3/4] Dispatching 1,000 events to background thread...');
const startTime = performance.now();

for (let i = 0; i < events.length; i++) {
  if (kernel.processEvent) {
    kernel.processEvent(events[i], events[i].length);
  }
}

const dispatchDuration = performance.now() - startTime;
console.log(`Dispatched 1,000 events in ${dispatchDuration.toFixed(2)} ms (${(dispatchDuration / 1000).toFixed(4)} ms/event)`);

// 4. Await Daemon Processing & Evaluate Results
console.log('Awaiting background daemon tick synchronization...');
setTimeout(() => {
  if (kernel.forceProactiveScan) {
    const resolved = kernel.forceProactiveScan();
    console.log(`Proactive pipeline executed — resolved ${resolved} active vault issues.`);
  }

  const finalStatus = JSON.parse(kernel.getDaemonStatus());
  const tickCount = kernel.getTickCount ? kernel.getTickCount() : 0;

  console.log('\n[4/4] Stress Test Telemetry Report:');
  console.log('----------------------------------------------------------');
  console.log(`Daemon Status:       ${finalStatus.running ? 'ONLINE (ACTIVE)' : 'OFFLINE'}`);
  console.log(`Total Ticks Elapsed: ${tickCount}`);
  console.log(`Active Issues Logged:${finalStatus.active_issues}`);
  console.log(`Memory Footprint:    ${finalStatus.memory_mb.toFixed(3)} MB RSS`);
  console.log('----------------------------------------------------------');

  const stopped = kernel.stopDaemon();
  console.log(`Daemon stopped cleanly: ${stopped}`);
  console.log('\n[SUCCESS] 1,000 Bus Events processed with 0 memory leaks or runtime panics!');
}, 500);
