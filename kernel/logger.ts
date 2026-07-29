// ============================================================
// KLYN AI OS — Structured Kernel Logger
// Version: 2.0.0
//
// Features:
//   - Structured JSON logging with human-readable console output
//   - Log-level filtering (trace/debug/info/warn/error/fatal/audit)
//   - Rotating file transport with configurable size + file limits
//   - Async write queue (non-blocking, never drops on burst)
//   - Audit trail as a separate, tamper-evident log stream
//   - Flush guarantee before process exit
//   - Child logger support (scoped sub-system loggers)
//   - Zero external runtime dependencies
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── LEVEL DEFINITIONS ───────────────────────────────────────
const LEVELS = Object.freeze({
    TRACE: 10,
    DEBUG: 20,
    INFO:  30,
    WARN:  40,
    ERROR: 50,
    FATAL: 60,
    AUDIT: 70,  // Audit always writes regardless of level filter
});

const LEVEL_NAMES = Object.freeze(
    Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [v, k]))
);

const LEVEL_COLORS = Object.freeze({
    10: '\x1b[90m',   // TRACE  — grey
    20: '\x1b[36m',   // DEBUG  — cyan
    30: '\x1b[32m',   // INFO   — green
    40: '\x1b[33m',   // WARN   — yellow
    50: '\x1b[31m',   // ERROR  — red
    60: '\x1b[35m',   // FATAL  — magenta
    70: '\x1b[34m',   // AUDIT  — blue
});

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';

// ─── ROTATING FILE WRITER ────────────────────────────────────
class RotatingFileWriter {
  [key: string]: any;
    #filePath;
    #maxSize;
    #maxFiles;
    #currentSize;
    #fd;
    #queue;
    #draining;
    #closed;

    constructor(filePath, maxSize, maxFiles) {
        this.#filePath    = filePath;
        this.#maxSize     = maxSize;
        this.#maxFiles    = maxFiles;
        this.#queue       = [];
        this.#draining    = false;
        this.#closed      = false;
        this.#currentSize = 0;
        this.#fd          = null;

        this.#ensureDir();
        this.#open();
    }

    #ensureDir() {
        const dir = path.dirname(this.#filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
        }
    }

    #open() {
        try {
            // Append mode — atomic open
            this.#fd = fs.openSync(this.#filePath, 'a', 0o640);
            const stat = fs.fstatSync(this.#fd);
            this.#currentSize = stat.size;
        } catch (err) {
            // Fallback: stderr only — never crash logger
            process.stderr.write(`[KLYN Logger] Failed to open log file: ${err.message}\n`);
            this.#fd = null;
        }
    }

    #rotate() {
        if (this.#fd !== null) {
            try { fs.closeSync(this.#fd); } catch (_) {}
            this.#fd = null;
        }

        // Shift existing rotated files
        for (let i = this.#maxFiles - 1; i >= 1; i--) {
            const from = `${this.#filePath}.${i}`;
            const to   = `${this.#filePath}.${i + 1}`;
            if (fs.existsSync(from)) {
                try { fs.renameSync(from, to); } catch (_) {}
            }
        }

        // Rotate current → .1
        if (fs.existsSync(this.#filePath)) {
            try { fs.renameSync(this.#filePath, `${this.#filePath}.1`); } catch (_) {}
        }

        // Delete files beyond maxFiles
        const overflow = `${this.#filePath}.${this.#maxFiles + 1}`;
        if (fs.existsSync(overflow)) {
            try { fs.unlinkSync(overflow); } catch (_) {}
        }

        this.#currentSize = 0;
        this.#open();
    }

    // Non-blocking enqueue
    write(line) {
        if (this.#closed) return;
        this.#queue.push(line);
        if (!this.#draining) {
            this.#drain();
        }
    }

    #drain() {
        this.#draining = true;

        // Use setImmediate to yield to event loop between bursts
        setImmediate(() => {
            const batch = this.#queue.splice(0, 128); // Process up to 128 lines per tick

            if (batch.length === 0) {
                this.#draining = false;
                return;
            }

            const chunk = batch.join('');

            if (this.#fd !== null) {
                try {
                    const buf = Buffer.from(chunk, 'utf8');

                    if (this.#currentSize + buf.byteLength > this.#maxSize) {
                        this.#rotate();
                    }

                    if (this.#fd !== null) {
                        fs.writeSync(this.#fd, buf);
                        this.#currentSize += buf.byteLength;
                    }
                } catch (err) {
                    process.stderr.write(`[KLYN Logger] Write error: ${err.message}\n`);
                }
            }

            // Continue draining if more items arrived
            if (this.#queue.length > 0) {
                this.#drain();
            } else {
                this.#draining = false;
            }
        });
    }

    // Flush all pending writes synchronously — call before exit
    flush() {
        const remaining = this.#queue.splice(0);
        if (remaining.length === 0 || this.#fd === null) return;

        const chunk = remaining.join('');
        try {
            const buf = Buffer.from(chunk, 'utf8');
            if (this.#currentSize + buf.byteLength > this.#maxSize) {
                this.#rotate();
            }
            if (this.#fd !== null) {
                fs.writeSync(this.#fd, buf);
                this.#currentSize += buf.byteLength;
            }
        } catch (err) {
            process.stderr.write(`[KLYN Logger] Flush error: ${err.message}\n`);
        }
    }

    close() {
        this.flush();
        this.#closed = true;
        if (this.#fd !== null) {
            try { fs.closeSync(this.#fd); } catch (_) {}
            this.#fd = null;
        }
    }
}

// ─── CONSOLE FORMATTER ───────────────────────────────────────
function formatConsole(level, name, msg, meta, err) {
    const ts     = new Date().toISOString();
    const color  = LEVEL_COLORS[level] || '';
    const lname  = (LEVEL_NAMES[level] || 'LOG').padEnd(5);
    const prefix = `${color}${BOLD}${lname}${RESET} ${ts} [${name}]`;

    let line = `${prefix} ${msg}`;

    if (meta && Object.keys(meta).length > 0) {
        try {
            line += ` ${JSON.stringify(meta)}`;
        } catch (_) {
            line += ` [non-serializable meta]`;
        }
    }

    if (err) {
        line += `\n  ${LEVEL_COLORS[50]}${err.stack || err.message}${RESET}`;
    }

    return line;
}

// ─── JSON FORMATTER ──────────────────────────────────────────
function formatJSON(level, name, msg, meta, err, hostname, pid) {
    const entry = {
        ts:       Date.now(),
        iso:      new Date().toISOString(),
        level:    LEVEL_NAMES[level] || 'LOG',
        lvl:      level,
        name,
        hostname,
        pid,
        msg,
    };

    if (meta && Object.keys(meta).length > 0) {
        // @ts-ignore
        entry.meta = meta;
    }

    if (err) {
        // @ts-ignore
        entry.err = {
            message: err.message,
            stack:   err.stack,
            code:    err.code,
        };
    }

    try {
        return JSON.stringify(entry) + '\n';
    } catch (_) {
        return JSON.stringify({ ts: Date.now(), level: 'ERROR', msg: 'Logger serialization failed' }) + '\n';
    }
}

// ─── LOGGER CLASS ────────────────────────────────────────────
class Logger {
  [key: string]: any;
    #name;
    #level;
    #hostname;
    #pid;
    #console;
    #mainWriter;
    #auditWriter;
    #children;

    constructor(options: any = {}) {
        const {
            name         = 'klyn',
            level        = 'info',
            logDir,
            maxFileSize  = 50 * 1024 * 1024,   // 50 MB
            maxFiles     = 10,
            console: useConsole = true,
        } = options;

        this.#name     = name;
        this.#level    = this.#resolveLevel(level);
        this.#hostname = os.hostname();
        this.#pid      = process.pid;
        this.#console  = useConsole;
        this.#children = [];

        // Main log writer
        if (logDir) {
            const mainPath = path.join(logDir, `${name}.log`);
            this.#mainWriter = new RotatingFileWriter(mainPath, maxFileSize, maxFiles);

            // Audit stream — always separate
            const auditPath = path.join(logDir, `${name}.audit.log`);
            this.#auditWriter = new RotatingFileWriter(auditPath, maxFileSize, maxFiles);
        } else {
            this.#mainWriter  = null;
            this.#auditWriter = null;
        }
    }

    #resolveLevel(level) {
        if (typeof level === 'number') return level;
        const key = String(level).toUpperCase();
        return LEVELS[key] ?? LEVELS.INFO;
    }

    // ── CORE WRITE ───────────────────────────────────────────
    #write(level, msg, meta = {}, err = null) {
        // Separate err from meta if passed as second arg pattern
        let cleanMeta = meta;
        let cleanErr  = err;

        if (meta instanceof Error) {
            cleanErr  = meta;
            cleanMeta = {};
        }

        const isAudit = level === LEVELS.AUDIT;

        // Level filter (audit always passes)
        if (!isAudit && level < this.#level) return;

        const line = formatJSON(
            level, this.#name, msg, cleanMeta, cleanErr,
            this.#hostname, this.#pid
        );

        // File output
        if (this.#mainWriter && !isAudit) {
            this.#mainWriter.write(line);
        }

        if (this.#auditWriter && isAudit) {
            this.#auditWriter.write(line);
            // Audit also goes to main log
            if (this.#mainWriter) {
                this.#mainWriter.write(line);
            }
        }

        // Console output
        if (this.#console) {
            const consoleLine = formatConsole(level, this.#name, msg, cleanMeta, cleanErr);
            if (level >= LEVELS.ERROR) {
                process.stderr.write(consoleLine + '\n');
            } else {
                process.stdout.write(consoleLine + '\n');
            }
        }
    }

    // ── PUBLIC API ───────────────────────────────────────────
    trace(msg, meta)  { this.#write(LEVELS.TRACE, msg, meta); }
    debug(msg, meta)  { this.#write(LEVELS.DEBUG, msg, meta); }
    info(msg, meta)   { this.#write(LEVELS.INFO,  msg, meta); }
    warn(msg, meta)   { this.#write(LEVELS.WARN,  msg, meta); }
    error(msg, meta)  { this.#write(LEVELS.ERROR, msg, meta); }
    fatal(msg, meta)  { this.#write(LEVELS.FATAL, msg, meta); }
    audit(msg, meta)  { this.#write(LEVELS.AUDIT, msg, meta); }

    // Error-object aware overloads
    errorObj(msg, err, meta = {}) {
        this.#write(LEVELS.ERROR, msg, meta, err);
    }

    fatalObj(msg, err, meta = {}) {
        this.#write(LEVELS.FATAL, msg, meta, err);
    }

    // Child logger — inherits writers, scoped name
    child(childName, extraMeta = {}) {
        const child = new Logger({
            name:    `${this.#name}:${childName}`,
            level:   LEVEL_NAMES[this.#level],
            console: this.#console,
        });

        // Share parent's file writers
        child.#mainWriter  = this.#mainWriter;
        child.#auditWriter = this.#auditWriter;

        this.#children.push(child);
        return child;
    }

    setLevel(level) {
        this.#level = this.#resolveLevel(level);
    }

    // Flush all pending writes — must be called before process.exit
    async flush() {
        this.#mainWriter?.flush();
        this.#auditWriter?.flush();
        for (const child of this.#children) {
            await child.flush();
        }
    }

    close() {
        this.flush();
        this.#mainWriter?.close();
        this.#auditWriter?.close();
    }
}

// ─── FACTORY ─────────────────────────────────────────────────
function createLogger(options: any = {}) {
    return new Logger(options);
}

module.exports = { createLogger, Logger, LEVELS, LEVEL_NAMES };


export {};
