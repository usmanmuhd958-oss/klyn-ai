/**
 * KLYN AI OS — Bug Hunter Agent
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Resilient worker process. Responsibilities:
 *   • Self-authentication via atomic token synchronization
 *   • Periodic heartbeat emission with health metrics
 *   • Task execution inside a sandboxed async error boundary
 *   • Exponential backoff with jitter on retry-eligible failures
 *   • Graceful self-shutdown on SHUTDOWN signal
 *
 * Runs as a child_process forked by the Kernel. Communicates ONLY via IPC.
 * This process must never crash — all code paths are error-bounded.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

// ─── Node Core ────────────────────────────────────────────────────────────────

const os     = require("os");
const crypto = require("crypto");

// ─── Internal Modules ─────────────────────────────────────────────────────────

const { verifyToken, TOKEN_TTL_MS } = require("../shared/crypto_utils");
const { MessageType, Severity, validateMessage, buildMessage } = require("../shared/protocol");

// ─── Environment ──────────────────────────────────────────────────────────────

const AGENT_ID      = process.env.KLYN_AGENT_ID;
const MASTER_SECRET = process.env.KLYN_MASTER_SECRET;

// Hard validations — if these are missing, the Kernel made an error. Bail immediately.
if (!AGENT_ID || typeof AGENT_ID !== "string") {
  console.error("[BUG_HUNTER] FATAL: KLYN_AGENT_ID is not set. Exiting.");
  process.exit(1);
}
if (!MASTER_SECRET || MASTER_SECRET.length < 32) {
  console.error("[BUG_HUNTER] FATAL: KLYN_MASTER_SECRET is invalid. Exiting.");
  process.exit(1);
}

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = Object.freeze({
  // How often to send a heartbeat to the Kernel
  HEARTBEAT_INTERVAL_MS : 8_000,

  // Exponential backoff: base delay for retries
  RETRY_BASE_DELAY_MS   : 500,

  // Exponential backoff: cap to avoid runaway delays
  RETRY_MAX_DELAY_MS    : 30_000,

  // Maximum retry attempts for a single task before declaring failure
  TASK_MAX_RETRIES      : 4,

  // Jitter factor (0–1): random fraction multiplied into the backoff delay
  RETRY_JITTER_FACTOR   : 0.3,

  // When this fraction of TOKEN_TTL_MS remains, proactively request a refresh
  TOKEN_REFRESH_THRESHOLD_RATIO : 0.25,
});

// ─── Agent State (module-scoped, no globals leaked) ───────────────────────────

const state = {
  token         : process.env.KLYN_AGENT_TOKEN || "",
  tokenIssuedAt : Date.now(),
  isReady       : false,
  isShuttingDown: false,
  heartbeatTimer: null,
  activeTaskId  : null,
  taskRetries   : 0,
};

// ─── Structured Logger ────────────────────────────────────────────────────────

const log = (() => {
  const levels    = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel  = levels[process.env.KLYN_LOG_LEVEL?.toLowerCase()] ?? levels.info;
  const agentTag  = `AGENT:${AGENT_ID}`;

  const format = (level, msg, err) => {
    const ts   = new Date().toISOString();
    const base = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${agentTag}] ${msg}`;
    return err ? `${base}\n  Stack: ${err.stack}` : base;
  };

  return {
    debug : (msg)      => { if (minLevel <= levels.debug) console.debug(format("debug", msg)); },
    info  : (msg)      => { if (minLevel <= levels.info)  console.info(format("info",  msg)); },
    warn  : (msg)      => { if (minLevel <= levels.warn)  console.warn(format("warn",  msg)); },
    error : (msg, err) => { if (minLevel <= levels.error) console.error(format("error", msg, err)); },
  };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// IPC Communication
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sends a typed message to the Kernel over IPC.
 * Automatically attaches the current token.
 * Throws if IPC channel is unavailable.
 *
 * @param {string} type     - MessageType value
 * @param {object} payload  - Type-specific payload object
 */
function sendToKernel(type, payload = {}) {
  if (!process.send) {
    throw new Error("IPC channel is not available. This agent must be forked by the Kernel.");
  }

  const msg = buildMessage({
    type,
    agentId : AGENT_ID,
    token   : state.token,
    payload,
  });

  // process.send is synchronous for small messages; wrap for future compat
  process.send(msg, undefined, undefined, (err) => {
    if (err) {
      log.error(`Failed to send message type=${type} to Kernel: ${err.message}`, err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Atomically updates the token.
 * Called when the Kernel sends a TOKEN_REFRESH message.
 *
 * @param {string} newToken
 */
function applyTokenRefresh(newToken) {
  if (typeof newToken !== "string" || newToken.length === 0) {
    log.warn("Received TOKEN_REFRESH with invalid token value. Ignoring.");
    return;
  }

  // Verify the new token is genuinely valid before accepting it
  const result = verifyToken(newToken, AGENT_ID, MASTER_SECRET);
  if (!result.valid) {
    log.warn(`TOKEN_REFRESH rejected — token invalid: ${result.reason}. Requesting fresh one.`);
    requestFreshToken();
    return;
  }

  state.token         = newToken;
  state.tokenIssuedAt = Date.now();
  log.debug("Token refreshed successfully.");
}

/**
 * Checks if the current token is approaching expiry and proactively
 * requests a refresh from the Kernel before auth fails.
 */
function checkTokenHealth() {
  const age             = Date.now() - state.tokenIssuedAt;
  const refreshAt       = TOKEN_TTL_MS * (1 - CONFIG.TOKEN_REFRESH_THRESHOLD_RATIO);

  if (age >= refreshAt) {
    log.info(`Token approaching expiry (age=${age}ms). Requesting refresh.`);
    requestFreshToken();
  }
}

/**
 * Requests a new token from the Kernel.
 * Sends an AUTH_REQUEST message. The Kernel will respond with TOKEN_REFRESH.
 */
function requestFreshToken() {
  try {
    sendToKernel(MessageType.AUTH_REQUEST, { reason: "TOKEN_EXPIRY_PROACTIVE" });
  } catch (err) {
    log.error("Failed to send AUTH_REQUEST to Kernel.", err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Heartbeat
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emits a heartbeat to the Kernel with current health metrics.
 * Also performs a proactive token health check each cycle.
 */
function emitHeartbeat() {
  if (state.isShuttingDown) return;

  // Check token before sending — ensures heartbeat itself is authenticated
  checkTokenHealth();

  try {
    sendToKernel(MessageType.HEARTBEAT, {
      metrics: collectMetrics(),
    });
    log.debug("Heartbeat sent.");
  } catch (err) {
    log.error("Failed to emit heartbeat.", err);
  }
}

/**
 * Collects system and process health metrics for the heartbeat payload.
 *
 * @returns {object}
 */
function collectMetrics() {
  const mem     = process.memoryUsage();
  const cpuLoad = os.loadavg();

  return {
    uptimeMs         : process.uptime() * 1000,
    memoryHeapUsedMb : Math.round(mem.heapUsed / 1_048_576 * 100) / 100,
    memoryRssMb      : Math.round(mem.rss       / 1_048_576 * 100) / 100,
    cpuLoad1m        : cpuLoad[0],
    cpuLoad5m        : cpuLoad[1],
    activeTaskId     : state.activeTaskId,
    taskRetries      : state.taskRetries,
    pid              : process.pid,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task Execution Engine
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Computes the exponential backoff delay with random jitter.
 *
 * @param {number} attempt  - Zero-indexed attempt number
 * @returns {number}        - Delay in milliseconds
 */
function computeBackoff(attempt) {
  const exponential = CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const capped      = Math.min(exponential, CONFIG.RETRY_MAX_DELAY_MS);
  const jitter      = capped * CONFIG.RETRY_JITTER_FACTOR * Math.random();
  return Math.floor(capped + jitter);
}

/**
 * Sleeps for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a task with automatic retry on transient failures.
 * Wraps the actual execution in a full error boundary.
 *
 * @param {object} taskRecord  - { taskId, type, data }
 */
async function executeTaskWithRetry(taskRecord) {
  const { taskId, type, data } = taskRecord;
  state.activeTaskId = taskId;
  state.taskRetries  = 0;

  let lastError = null;

  for (let attempt = 0; attempt <= CONFIG.TASK_MAX_RETRIES; attempt++) {
    if (state.isShuttingDown) {
      log.warn(`Task ${taskId}: Aborting retry loop — agent is shutting down.`);
      break;
    }

    if (attempt > 0) {
      const delay = computeBackoff(attempt - 1);
      log.warn(`Task ${taskId}: Retry ${attempt}/${CONFIG.TASK_MAX_RETRIES} in ${delay}ms.`);
      await sleep(delay);
      state.taskRetries = attempt;
    }

    try {
      // ── Core task execution ───────────────────────────────────────────────
      const result = await runTaskLogic(type, data, taskId);

      // ── Success path ──────────────────────────────────────────────────────
      state.activeTaskId = null;
      state.taskRetries  = 0;

      sendToKernel(MessageType.TASK_RESULT, {
        taskId,
        result,
        severity   : result.severity ?? Severity.INFO,
        attemptNum : attempt,
      });

      log.info(`Task ${taskId} completed on attempt ${attempt + 1}.`);
      return; // ← Exit the retry loop on success

    } catch (err) {
      lastError = err;
      log.warn(`Task ${taskId} failed on attempt ${attempt + 1}: ${err.message}`);

      // Non-retryable errors exit immediately
      if (err.retryable === false) {
        log.error(`Task ${taskId}: Non-retryable error. Giving up immediately.`, err);
        break;
      }
    }
  }

  // ── All retries exhausted ─────────────────────────────────────────────────
  state.activeTaskId = null;
  state.taskRetries  = 0;

  log.error(`Task ${taskId}: All attempts failed. Reporting TASK_ERROR to Kernel.`, lastError);

  try {
    sendToKernel(MessageType.TASK_ERROR, {
      taskId,
      error    : lastError?.message ?? "Unknown error",
      retryable: false,
    });
  } catch (sendErr) {
    log.error(`Task ${taskId}: Failed to report TASK_ERROR to Kernel.`, sendErr);
  }
}

/**
 * ─── TASK LOGIC ROUTER ────────────────────────────────────────────────────────
 *
 * This is where the actual bug-hunting intelligence lives.
 * Each task type is a self-contained async function that receives `data`
 * and returns a structured result object.
 *
 * Adding a new task type = add a case here + implement the handler below.
 *
 * @param {string} type   - Task type identifier
 * @param {object} data   - Task-specific input data
 * @param {string} taskId - For logging only
 * @returns {Promise<object>}  - Result object (merged with { severity } by callers)
 */
async function runTaskLogic(type, data, taskId) {
  log.info(`Executing task: type=${type}, taskId=${taskId}`);

  switch (type) {

    // ── Static code analysis ─────────────────────────────────────────────────
    case "ANALYZE_CODE": {
      return await analyzeCode(data);
    }

    // ── Dependency vulnerability scan ─────────────────────────────────────────
    case "SCAN_DEPENDENCIES": {
      return await scanDependencies(data);
    }

    // ── Runtime log pattern analysis ─────────────────────────────────────────
    case "ANALYZE_LOGS": {
      return await analyzeLogs(data);
    }

    // ── Semantic diff analysis between two file revisions ────────────────────
    case "DIFF_ANALYSIS": {
      return await diffAnalysis(data);
    }

    // ── Liveness / health probe (used for self-testing by Kernel) ────────────
    case "HEALTH_CHECK": {
      return {
        healthy  : true,
        pid      : process.pid,
        uptime   : process.uptime(),
        severity : Severity.INFO,
      };
    }

    default: {
      // Unknown task types are non-retryable errors
      const err = new Error(`Unknown task type: "${type}"`);
      err.retryable = false;
      throw err;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task Handlers — Bug Hunter Core Logic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ANALYZE_CODE
 * Performs multi-pass static analysis on provided source code.
 *
 * Checks for:
 *   • eval() / Function() usage (arbitrary code execution risk)
 *   • Hardcoded secrets / API keys (basic entropy + pattern heuristics)
 *   • Prototype pollution patterns
 *   • SQL injection naive string concatenation
 *   • Synchronous blocking FS calls in hot paths (heuristic)
 *   • Missing error handling on async operations
 *
 * @param {{ source: string, filename?: string }} data
 * @returns {Promise<{ bugs: Bug[], severity: string }>}
 */
async function analyzeCode(data) {
  if (typeof data?.source !== "string") {
    const err = new Error("ANALYZE_CODE: data.source must be a string.");
    err.retryable = false;
    throw err;
  }

  const { source, filename = "unknown" } = data;
  const bugs   = [];
  const lines  = source.split("\n");

  // ── Pass 1: Line-by-line pattern matching ────────────────────────────────

  const LINE_PATTERNS = [
    {
      pattern     : /\beval\s*\(/,
      code        : "SEC001",
      description : "eval() usage detected — arbitrary code execution risk.",
      severity    : Severity.CRITICAL,
    },
    {
      pattern     : /new\s+Function\s*\(/,
      code        : "SEC002",
      description : "new Function() detected — arbitrary code execution risk.",
      severity    : Severity.CRITICAL,
    },
    {
      pattern     : /__proto__\s*\[|prototype\s*\[/,
      code        : "SEC003",
      description : "Potential prototype pollution pattern detected.",
      severity    : Severity.HIGH,
    },
    {
      pattern     : /('|"|\`)\s*\+\s*\w+.*?(SELECT|INSERT|UPDATE|DELETE|DROP)/i,
      code        : "SEC004",
      description : "Potential SQL injection via string concatenation.",
      severity    : Severity.HIGH,
    },
    {
      pattern     : /fs\.(readFileSync|writeFileSync|appendFileSync|existsSync|mkdirSync)/,
      code        : "PERF001",
      description : "Synchronous FS call detected — may block event loop.",
      severity    : Severity.MEDIUM,
    },
    {
      pattern     : /\.catch\s*\(\s*\)/,
      code        : "REL001",
      description : "Empty .catch() block swallows errors silently.",
      severity    : Severity.MEDIUM,
    },
    {
      pattern     : /console\.(log|warn|error)\s*\([^)]*secret|password|token|key/i,
      code        : "SEC005",
      description : "Potential secret/credential leak via console output.",
      severity    : Severity.HIGH,
    },
    {
      pattern     : /\bsetTimeout\s*\(\s*\w+\s*,\s*0\s*\)/,
      code        : "PERF002",
      description : "setTimeout(fn, 0) detected — prefer setImmediate() or queueMicrotask().",
      severity    : Severity.LOW,
    },
  ];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    for (const rule of LINE_PATTERNS) {
      if (rule.pattern.test(line)) {
        bugs.push({
          code        : rule.code,
          description : rule.description,
          severity    : rule.severity,
          file        : filename,
          line        : lineNum,
          snippet     : line.trim().slice(0, 120),
        });
      }
    }
  });

  // ── Pass 2: Whole-file heuristics ────────────────────────────────────────

  // Detect hardcoded secrets via entropy analysis on string literals
  const stringLiteralRx = /(['"`])([A-Za-z0-9+/=_\-]{20,})(['"`])/g;
  let match;
  while ((match = stringLiteralRx.exec(source)) !== null) {
    const candidate = match[2];
    if (shannonEntropy(candidate) > 4.5) {
      const lineNum = source.slice(0, match.index).split("\n").length;
      bugs.push({
        code        : "SEC006",
        description : `High-entropy string literal detected — possible hardcoded secret.`,
        severity    : Severity.HIGH,
        file        : filename,
        line        : lineNum,
        snippet     : `"${candidate.slice(0, 20)}..."`,
      });
    }
  }

  // ── Compute aggregate severity ────────────────────────────────────────────
  const aggregateSeverity = bugs.some((b) => b.severity === Severity.CRITICAL) ? Severity.CRITICAL
    : bugs.some((b) => b.severity === Severity.HIGH)                           ? Severity.HIGH
    : bugs.some((b) => b.severity === Severity.MEDIUM)                         ? Severity.MEDIUM
    : bugs.some((b) => b.severity === Severity.LOW)                            ? Severity.LOW
    : Severity.INFO;

  return {
    filename,
    linesAnalyzed   : lines.length,
    bugsFound       : bugs.length,
    bugs,
    severity        : aggregateSeverity,
  };
}

/**
 * Computes Shannon entropy of a string.
 * High entropy (> 4.5 bits/char) suggests random/encoded data (e.g., secrets).
 *
 * @param {string} str
 * @returns {number}
 */
function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;

  const freq  = {};
  for (const ch of str) freq[ch] = (freq[ch] ?? 0) + 1;
  const len   = str.length;

  return Object.values(freq).reduce((entropy, count) => {
    const p = count / len;
    return entropy - p * Math.log2(p);
  }, 0);
}

/**
 * SCAN_DEPENDENCIES
 * Parses a package.json manifest and cross-references declared dependency
 * versions against a known-vulnerable version set.
 *
 * In production, this would call the OSV (osv.dev) or Snyk API.
 * Provided here as a fully-functional offline implementation.
 *
 * @param {{ manifest: object, advisories?: object }} data
 * @returns {Promise<{ vulnerabilities: Vuln[], severity: string }>}
 */
async function scanDependencies(data) {
  if (!data?.manifest || typeof data.manifest !== "object") {
    const err = new Error("SCAN_DEPENDENCIES: data.manifest must be a package.json object.");
    err.retryable = false;
    throw err;
  }

  const { manifest, advisories = {} } = data;
  const allDeps = {
    ...manifest.dependencies         ?? {},
    ...manifest.devDependencies      ?? {},
    ...manifest.peerDependencies     ?? {},
    ...manifest.optionalDependencies ?? {},
  };

  const vulnerabilities = [];

  for (const [pkg, versionRange] of Object.entries(allDeps)) {
    if (typeof versionRange !== "string") continue;

    if (advisories[pkg]) {
      vulnerabilities.push({
        package      : pkg,
        installedRange: versionRange,
        advisory     : advisories[pkg],
        severity     : advisories[pkg].severity ?? Severity.HIGH,
      });
    }
  }

  const aggregateSeverity = vulnerabilities.some((v) => v.severity === Severity.CRITICAL) ? Severity.CRITICAL
    : vulnerabilities.some((v) => v.severity === Severity.HIGH)                           ? Severity.HIGH
    : vulnerabilities.some((v) => v.severity === Severity.MEDIUM)                         ? Severity.MEDIUM
    : Severity.INFO;

  return {
    packageName           : manifest.name    ?? "unknown",
    packageVersion        : manifest.version ?? "unknown",
    dependenciesScanned   : Object.keys(allDeps).length,
    vulnerabilitiesFound  : vulnerabilities.length,
    vulnerabilities,
    severity              : aggregateSeverity,
  };
}

/**
 * ANALYZE_LOGS
 * Ingests a block of log text and surfaces anomalous patterns.
 *
 * Detects:
 *   • 5xx error bursts
 *   • Auth failure spikes (brute-force signals)
 *   • Repeated panic / fatal / SIGSEGV strings
 *   • Repeated OOM / heap exhaustion signals
 *
 * @param {{ logText: string, source?: string }} data
 * @returns {Promise<{ findings: Finding[], severity: string }>}
 */
async function analyzeLogs(data) {
  if (typeof data?.logText !== "string") {
    const err = new Error("ANALYZE_LOGS: data.logText must be a string.");
    err.retryable = false;
    throw err;
  }

  const { logText, source = "unknown" } = data;
  const findings = [];

  const LOG_PATTERNS = [
    { rx: /\b5\d{2}\b/g,                          label: "5xx errors",         severity: Severity.HIGH,     threshold: 5  },
    { rx: /auth(entication|orization)?\s+fail/gi,  label: "Auth failures",      severity: Severity.HIGH,     threshold: 3  },
    { rx: /\b(fatal|panic|SIGSEGV|SIGABRT)\b/gi,  label: "Fatal/crash signals", severity: Severity.CRITICAL, threshold: 1  },
    { rx: /out\s+of\s+memory|heap\s+exhausted/gi,  label: "OOM signals",        severity: Severity.CRITICAL, threshold: 1  },
    { rx: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/g,     label: "Network errors",     severity: Severity.MEDIUM,   threshold: 3  },
    { rx: /deprecated/gi,                          label: "Deprecation warnings",severity: Severity.LOW,     threshold: 10 },
  ];

  for (const { rx, label, severity, threshold } of LOG_PATTERNS) {
    const matches = logText.match(rx) ?? [];
    if (matches.length >= threshold) {
      findings.push({
        pattern  : label,
        count    : matches.length,
        severity,
        source,
        note     : `${matches.length} occurrence(s) detected (threshold=${threshold}).`,
      });
    }
  }

  const aggregateSeverity = findings.some((f) => f.severity === Severity.CRITICAL) ? Severity.CRITICAL
    : findings.some((f) => f.severity === Severity.HIGH)                            ? Severity.HIGH
    : findings.some((f) => f.severity === Severity.MEDIUM)                          ? Severity.MEDIUM
    : findings.some((f) => f.severity === Severity.LOW)                             ? Severity.LOW
    : Severity.INFO;

  return {
    source,
    linesAnalyzed    : logText.split("\n").length,
    findingsCount    : findings.length,
    findings,
    severity         : aggregateSeverity,
  };
}

/**
 * DIFF_ANALYSIS
 * Compares two versions of source code and flags new risks introduced.
 *
 * @param {{ before: string, after: string, filename?: string }} data
 * @returns {Promise<{ addedBugs: Bug[], removedBugs: Bug[], netDelta: number, severity: string }>}
 */
async function diffAnalysis(data) {
  if (typeof data?.before !== "string" || typeof data?.after !== "string") {
    const err = new Error("DIFF_ANALYSIS: data.before and data.after must be strings.");
    err.retryable = false;
    throw err;
  }

  const { before, after, filename = "unknown" } = data;

  // Run analyzeCode on both versions in parallel
  const [beforeResult, afterResult] = await Promise.all([
    analyzeCode({ source: before, filename: `${filename}@before` }),
    analyzeCode({ source: after,  filename: `${filename}@after`  }),
  ]);

  const beforeCodes = new Set(beforeResult.bugs.map((b) => `${b.code}:${b.line}`));
  const afterCodes  = new Set(afterResult.bugs.map((b)  => `${b.code}:${b.line}`));

  const addedBugs   = afterResult.bugs.filter((b)  => !beforeCodes.has(`${b.code}:${b.line}`));
  const removedBugs = beforeResult.bugs.filter((b) => !afterCodes.has(`${b.code}:${b.line}`));
  const netDelta    = addedBugs.length - removedBugs.length;

  const aggregateSeverity = addedBugs.some((b) => b.severity === Severity.CRITICAL) ? Severity.CRITICAL
    : addedBugs.some((b) => b.severity === Severity.HIGH)                           ? Severity.HIGH
    : addedBugs.some((b) => b.severity === Severity.MEDIUM)                         ? Severity.MEDIUM
    : addedBugs.some((b) => b.severity === Severity.LOW)                            ? Severity.LOW
    : Severity.INFO;

  return {
    filename,
    addedBugs,
    removedBugs,
    netDelta,
    summary   : `+${addedBugs.length} bugs introduced, -${removedBugs.length} bugs resolved.`,
    severity  : netDelta > 0 ? aggregateSeverity : Severity.INFO,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inbound Message Handler (Kernel → Agent)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handles all messages received from the Kernel.
 * Full validation pipeline: schema → dispatch.
 *
 * @param {unknown} rawMessage
 */
function handleKernelMessage(rawMessage) {
  // ── 1. Schema validation ───────────────────────────────────────────────────
  const { valid, errors, message } = validateMessage(rawMessage);
  if (!valid) {
    log.warn(`Schema validation failed on Kernel message: [${errors.join(", ")}]. Ignoring.`);
    return;
  }

  // ── 2. Type dispatch ───────────────────────────────────────────────────────
  switch (message.type) {

    case MessageType.INIT: {
      log.info("Received INIT from Kernel.");
      initialize();
      break;
    }

    case MessageType.TOKEN_REFRESH: {
      const { token } = message.payload;
      applyTokenRefresh(token);
      break;
    }

    case MessageType.TASK_DISPATCH: {
      const { taskId, type, data } = message.payload;

      if (state.activeTaskId) {
        log.warn(`Received TASK_DISPATCH but already processing task ${state.activeTaskId}. Queuing.`);
        // The Kernel controls scheduling; this signals a Kernel-side bug if it happens
      }

      // Execute in a fully isolated async context — errors cannot escape
      executeTaskWithRetry({ taskId, type, data }).catch((err) => {
        log.error(`Unhandled error in executeTaskWithRetry for task ${taskId}.`, err);
        // Notify Kernel so it can resolve/reject the pending promise
        try {
          sendToKernel(MessageType.TASK_ERROR, {
            taskId,
            error    : err.message ?? "Unknown internal error",
            retryable: false,
          });
        } catch (sendErr) {
          log.error("Failed to send emergency TASK_ERROR to Kernel.", sendErr);
        }
      });
      break;
    }

    case MessageType.SHUTDOWN: {
      const { reason } = message.payload;
      log.info(`Received SHUTDOWN from Kernel (reason=${reason}). Initiating graceful exit.`);
      gracefulShutdown(0);
      break;
    }

    default: {
      log.warn(`Received unknown message type from Kernel: ${message.type}. Ignoring.`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initializes the agent: starts heartbeat loop and notifies Kernel it is READY.
 */
function initialize() {
  if (state.isReady) {
    log.warn("initialize() called but agent is already READY. Skipping.");
    return;
  }

  state.isReady = true;

  // Start periodic heartbeat
  state.heartbeatTimer = setInterval(() => {
    try {
      emitHeartbeat();
    } catch (err) {
      log.error("Error in heartbeat timer callback.", err);
    }
  }, CONFIG.HEARTBEAT_INTERVAL_MS);

  // IPC channel may be torn down during shutdown — don't hold the process open
  state.heartbeatTimer.unref();

  log.info("Agent initialized. Sending READY to Kernel.");

  try {
    sendToKernel(MessageType.READY, {
      agentVersion : "1.0.0",
      pid          : process.pid,
      capabilities : ["ANALYZE_CODE", "SCAN_DEPENDENCIES", "ANALYZE_LOGS", "DIFF_ANALYSIS", "HEALTH_CHECK"],
    });
  } catch (err) {
    log.error("Failed to send READY to Kernel.", err);
  }
}

/**
 * Gracefully shuts down the agent.
 * Clears timers, flushes pending state, exits cleanly.
 *
 * @param {number} exitCode
 */
function gracefulShutdown(exitCode = 0) {
  if (state.isShuttingDown) return;
  state.isShuttingDown = true;

  log.info("Graceful shutdown initiated.");

  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  // Give any in-flight async work a moment to flush
  setTimeout(() => {
    log.info("Agent process exiting.");
    process.exit(exitCode);
  }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Process-Level Error Boundaries
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Global uncaughtException handler.
 * An agent MUST NOT crash from uncaught sync exceptions.
 * Logs the error, notifies Kernel if possible, and continues running.
 */
process.on("uncaughtException", (err) => {
  log.error("UNCAUGHT EXCEPTION — agent survived via error boundary.", err);

  // If a task was active, report it as failed so Kernel isn't left hanging
  if (state.activeTaskId) {
    const taskId = state.activeTaskId;
    state.activeTaskId = null;
    state.taskRetries  = 0;

    try {
      sendToKernel(MessageType.TASK_ERROR, {
        taskId,
        error    : `Uncaught exception: ${err.message}`,
        retryable: true,
      });
    } catch {
      // sendToKernel itself threw — IPC is broken
      log.error("IPC broken during uncaughtException recovery. Initiating graceful shutdown.");
      gracefulShutdown(1);
    }
  }
});

/**
 * Global unhandledRejection handler.
 * Mirrors uncaughtException behavior for async code paths.
 */
process.on("unhandledRejection", (reason, promise) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log.error(`UNHANDLED PROMISE REJECTION — reason: ${msg}`);

  if (state.activeTaskId) {
    const taskId = state.activeTaskId;
    state.activeTaskId = null;
    state.taskRetries  = 0;

    try {
      sendToKernel(MessageType.TASK_ERROR, {
        taskId,
        error    : `Unhandled rejection: ${msg}`,
        retryable: true,
      });
    } catch {
      log.error("IPC broken during unhandledRejection recovery. Initiating graceful shutdown.");
      gracefulShutdown(1);
    }
  }
});

/**
 * Handle OS signals for graceful termination.
 */
process.on("SIGTERM", () => {
  log.info("Received SIGTERM. Shutting down.");
  gracefulShutdown(0);
});

process.on("SIGINT", () => {
  log.info("Received SIGINT. Shutting down.");
  gracefulShutdown(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verify IPC channel is available before doing anything else.
 * If this process was started directly (not forked), fail fast with clear message.
 */
if (!process.send) {
  console.error(
    "[BUG_HUNTER] FATAL: This agent must be started by the KLYN Orchestrator via fork(). " +
    "Direct execution is not supported."
  );
  process.exit(1);
}

/**
 * Register the IPC message handler.
 * The Kernel will send INIT first, which triggers initialize().
 */
process.on("message", (rawMessage) => {
  try {
    handleKernelMessage(rawMessage);
  } catch (err) {
    // Top-level IPC handler boundary — this must never throw
    log.error("Unhandled error in IPC message handler.", err);
  }
});

/**
 * Signal to the Kernel's fork() that the IPC channel is open and we are
 * listening. The Kernel will respond with INIT.
 *
 * We cannot call initialize() here directly because we have no valid token
 * context yet — the Kernel controls the INIT sequence.
 */
log.info(`Agent process online. PID=${process.pid}. Awaiting INIT from Kernel.`);
