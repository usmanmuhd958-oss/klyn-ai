/**
 * =============================================================================
 * KLYN AI OS — Structured Kernel Logger
 * File: kernel/src/observability/logger.js
 * Version: 1.0.0
 * Phase: 0 — Instrumentation
 * =============================================================================
 *
 * DESIGN CONTRACT:
 *   - Every log entry is a single-line JSON object written atomically to the
 *     appropriate output stream. This makes logs machine-parseable by any
 *     log aggregator without preprocessing.
 *   - Correlation IDs propagate across async boundaries so every log entry
 *     produced during a single operation can be traced end-to-end.
 *   - The logger is synchronous in its formatting and stream-write path to
 *     avoid event-loop scheduling jitter on Termux's constrained I/O.
 *   - No external dependencies. Pure Node.js core modules only.
 *
 * LOG LEVELS (ordered by severity, ascending):
 *   DEBUG < INFO < WARN < ERROR < SECURITY < FATAL
 *
 * OUTPUT FORMAT (JSON, one object per line):
 *   {
 *     "ts":        "<ISO-8601 timestamp>",
 *     "level":     "<LEVEL>",
 *     "component": "<component name>",
 *     "correlId":  "<correlation ID or null>",
 *     "msg":       "<human-readable message>",
 *     "data":      { ...structured metadata }
 *   }
 * =============================================================================
 */

'use strict';

const { randomBytes }  = require('crypto');
const { Writable }     = require('stream');

// =============================================================================
// SECTION 1: LEVEL DEFINITIONS
// =============================================================================

/**
 * Numeric severity values for each log level.
 * Allows efficient threshold comparison without string matching.
 * @enum {number}
 */
const LEVELS = Object.freeze({
  DEBUG:    10,
  INFO:     20,
  WARN:     30,
  ERROR:    40,
  SECURITY: 50,   // Dedicated level for security-boundary violations.
  FATAL:    60,   // Unrecoverable conditions requiring immediate process exit.
});

/**
 * Reverse map from numeric severity to level name string.
 * Used during JSON serialization.
 * @type {Object.<number, string>}
 */
const LEVEL_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(LEVELS).map(([name, val]) => [val, name]))
);

// =============================================================================
// SECTION 2: SAFE JSON SERIALIZER
// =============================================================================

/**
 * Serializes a value to a JSON string without throwing on circular references
 * or non-serializable types. Truncates oversized strings to protect against
 * log flooding on constrained Termux memory.
 *
 * @param {*}      value        The value to serialize.
 * @param {number} [maxLen=4096] Maximum length of the resulting JSON string.
 * @returns {string}
 */
function safeSerialize(value, maxLen = 4096) {
  const seen = new WeakSet();

  const replacer = (key, val) => {
    // Redact known sensitive key names even if they somehow reach the logger.
    if (typeof key === 'string' && SENSITIVE_KEY_PATTERN.test(key)) {
      return '[REDACTED]';
    }
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    if (typeof val === 'bigint') return val.toString();
    if (val instanceof Error) {
      return {
        errorType:    val.constructor.name,
        errorMessage: val.message,
        errorCode:    val.code,
        stack:        val.stack,
      };
    }
    if (val instanceof Buffer) return `[Buffer(${val.length})]`;
    return val;
  };

  try {
    const json = JSON.stringify(value, replacer);
    if (json.length > maxLen) {
      return JSON.stringify({
        _truncated: true,
        _original_length: json.length,
        _preview: json.slice(0, maxLen),
      });
    }
    return json;
  } catch (_) {
    return '"[UnserializableValue]"';
  }
}

/**
 * Pattern matching key names that should never appear in logs.
 * This is a last-resort safety net. Primary secret protection is the vault.
 * @type {RegExp}
 */
const SENSITIVE_KEY_PATTERN = /key|secret|password|token|credential|auth|hmac/i;

// =============================================================================
// SECTION 3: CORRELATION ID UTILITIES
// =============================================================================

/**
 * Generates a cryptographically random correlation ID.
 * Format: 16 hex characters (8 bytes), prefixed with 'cid_'.
 * Short enough to be readable in logs, long enough to be collision-resistant
 * across thousands of concurrent operations.
 *
 * @returns {string}  e.g. "cid_a3f1e29d4b7c8e0f"
 */
function generateCorrelationId() {
  return 'cid_' + randomBytes(8).toString('hex');
}

// =============================================================================
// SECTION 4: LOGGER CLASS
// =============================================================================

/**
 * KlynLogger — The structured JSON logger for the KLYN AI OS kernel.
 *
 * Instances are component-scoped: each subsystem creates its own logger
 * instance with its component name, so all log entries are automatically
 * tagged with the originating component without manual labeling.
 *
 * Usage:
 *   const { createLogger } = require('./logger');
 *   const log = createLogger('TokenVault');
 *   log.info('Vault initialized.', { secretCount: 4 });
 *   log.security('Unauthorized token request.', { requesterId: 'agent_x' });
 */
class KlynLogger {

  /**
   * @param {object} options
   * @param {string}   options.component     Component name embedded in every entry.
   * @param {number}   [options.minLevel]    Minimum numeric level to emit.
   * @param {Writable} [options.outStream]   Stream for INFO/DEBUG/WARN (default: stdout).
   * @param {Writable} [options.errStream]   Stream for ERROR/SECURITY/FATAL (default: stderr).
   * @param {string}   [options.correlId]    Default correlation ID for this logger instance.
   */
  constructor(options = {}) {
    this._component  = options.component  || 'Kernel';
    this._minLevel   = options.minLevel   ?? _resolveMinLevel();
    this._outStream  = options.outStream  || process.stdout;
    this._errStream  = options.errStream  || process.stderr;
    this._correlId   = options.correlId   || null;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC LOGGING METHODS
  // ---------------------------------------------------------------------------

  /** @param {string} msg @param {object} [data] @param {string} [correlId] */
  debug(msg, data, correlId) {
    this._emit(LEVELS.DEBUG, msg, data, correlId);
  }

  /** @param {string} msg @param {object} [data] @param {string} [correlId] */
  info(msg, data, correlId) {
    this._emit(LEVELS.INFO, msg, data, correlId);
  }

  /** @param {string} msg @param {object} [data] @param {string} [correlId] */
  warn(msg, data, correlId) {
    this._emit(LEVELS.WARN, msg, data, correlId);
  }

  /** @param {string} msg @param {object} [data] @param {string} [correlId] */
  error(msg, data, correlId) {
    this._emit(LEVELS.ERROR, msg, data, correlId);
  }

  /**
   * Dedicated security event logger. Entries at this level are written to
   * stderr and should be treated as high-priority alerts by log consumers.
   * @param {string} msg @param {object} [data] @param {string} [correlId]
   */
  security(msg, data, correlId) {
    this._emit(LEVELS.SECURITY, msg, data, correlId);
  }

  /**
   * Fatal condition logger. After writing the entry, the process exits.
   * Use only for unrecoverable kernel-level failures.
   * @param {string} msg @param {object} [data] @param {string} [correlId]
   */
  fatal(msg, data, correlId) {
    this._emit(LEVELS.FATAL, msg, data, correlId);
    // Synchronous exit: we cannot trust the event loop in a fatal state.
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // CHILD LOGGER
  // ---------------------------------------------------------------------------

  /**
   * Creates a child logger that inherits this logger's settings but binds
   * a specific correlation ID to every entry it produces. Use this at the
   * start of a correlated operation (e.g., a single agent spawn cycle).
   *
   * @param {string} [correlId]  Correlation ID to bind. Auto-generated if omitted.
   * @returns {KlynLogger}
   */
  child(correlId) {
    return new KlynLogger({
      component:  this._component,
      minLevel:   this._minLevel,
      outStream:  this._outStream,
      errStream:  this._errStream,
      correlId:   correlId || generateCorrelationId(),
    });
  }

  /**
   * Creates a child logger scoped to a sub-component name.
   * Useful for tracing a specific agent's log entries within a component.
   *
   * @param {string} subComponent  Sub-component label appended to the component name.
   * @param {string} [correlId]    Optional correlation ID.
   * @returns {KlynLogger}
   */
  scope(subComponent, correlId) {
    return new KlynLogger({
      component:  `${this._component}:${subComponent}`,
      minLevel:   this._minLevel,
      outStream:  this._outStream,
      errStream:  this._errStream,
      correlId:   correlId || this._correlId,
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE IMPLEMENTATION
  // ---------------------------------------------------------------------------

  /**
   * Core emit method. Constructs the JSON log entry and writes it atomically
   * to the appropriate output stream.
   *
   * @param {number} level    Numeric level constant from LEVELS.
   * @param {string} msg      Human-readable message string.
   * @param {*}      [data]   Arbitrary structured metadata.
   * @param {string} [correlId] Per-call correlation ID override.
   */
  _emit(level, msg, data, correlId) {
    if (level < this._minLevel) return;

    const entry = {
      ts:        new Date().toISOString(),
      level:     LEVEL_NAMES[level] || 'UNKNOWN',
      component: this._component,
      correlId:  correlId || this._correlId || null,
      msg:       String(msg),
      data:      data !== undefined ? data : null,
    };

    // Serialize to a single JSON line. The trailing newline is part of the
    // NDJSON (newline-delimited JSON) format expected by log aggregators.
    const line = safeSerialize(entry) + '\n';

    // Route to the correct stream based on severity.
    const stream = level >= LEVELS.ERROR ? this._errStream : this._outStream;

    // Write synchronously using the underlying stream write. On Termux,
    // synchronous writes prevent partial entries under heavy concurrent logging.
    try {
      stream.write(line);
    } catch (_) {
      // If the stream itself has failed, fall back to process.stderr directly.
      // This is a last-resort path; do not add logic here.
      process.stderr.write(line);
    }
  }
}

// =============================================================================
// SECTION 5: CONFIGURATION RESOLUTION
// =============================================================================

/**
 * Resolves the minimum log level from the environment variable KLYN_LOG_LEVEL.
 * Defaults to INFO in production and DEBUG in development.
 *
 * @returns {number}  Numeric level constant.
 */
function _resolveMinLevel() {
  const envLevel = process.env.KLYN_LOG_LEVEL?.toUpperCase();
  if (envLevel && LEVELS[envLevel] !== undefined) {
    return LEVELS[envLevel];
  }
  return process.env.NODE_ENV === 'development' ? LEVELS.DEBUG : LEVELS.INFO;
}

// =============================================================================
// SECTION 6: FACTORY & SINGLETON ROOT LOGGER
// =============================================================================

/**
 * Creates a new component-scoped logger instance.
 *
 * @param {string}  component  The component name for this logger.
 * @param {object}  [options]  Optional overrides (minLevel, streams).
 * @returns {KlynLogger}
 */
function createLogger(component, options = {}) {
  return new KlynLogger({ component, ...options });
}

/**
 * The root kernel logger. Used by top-level kernel modules.
 * All other loggers should be created with createLogger() for proper scoping.
 * @type {KlynLogger}
 */
const rootLogger = createLogger('KernelRoot');

// =============================================================================
// SECTION 7: EXPORTS
// =============================================================================

module.exports = Object.freeze({
  createLogger,
  generateCorrelationId,
  rootLogger,
  LEVELS,
  // Exposed for testing: allows overriding serialization behavior in tests.
  _safeSerialize: safeSerialize,
});
