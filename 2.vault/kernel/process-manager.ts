// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// ============================================================
// KLYN AI OS — Process Manager v3.0.0
//
// Architecture:
//   ManagedProcess  — full lifecycle FSM per agent
//   ProcessManager  — registry + supervisor
//
// State Machine:
//   PENDING → STARTING → RUNNING → STOPPING → STOPPED
//                    ↓               ↑
//                 CRASHED → RESTARTING (with exp backoff)
//                    ↓
//                 FAILED  (terminal — max restarts exceeded)
//
// Spawn Strategy:
//   .sh  files → spawn('bash', [script, ...args])
//   .js  files → spawn('node', [script, ...args])   ← NO fork()
//   binary     → spawn(script, args)
//
//   fork() is intentionally avoided — all agents communicate
//   via the filesystem mailbox, not Node IPC channels.
//   This makes shell agents and Node agents interchangeable.
//
// Features:
//   - Exponential backoff restart (full-jitter, AWS algorithm)
//   - Per-process memory monitoring via /proc/<pid>/statm
//   - Graceful SIGTERM → timeout → SIGKILL drain sequence
//   - stdout/stderr capture with line-buffered relay
//   - Environment isolation per agent
//   - Zero external dependencies
// ============================================================

'use strict';

const { spawn }        = require('child_process');
const fs               = require('fs');
const path             = require('path');
const { EventEmitter } = require('events');
const { computeBackoff, sleep } = require('./backoff');

// ─── CONSTANTS ───────────────────────────────────────────────
const PROC_STATE = Object.freeze({
    PENDING:    'PENDING',
    STARTING:   'STARTING',
    RUNNING:    'RUNNING',
    STOPPING:   'STOPPING',
    STOPPED:    'STOPPED',
    CRASHED:    'CRASHED',
    RESTARTING: 'RESTARTING',
    FAILED:     'FAILED',       // Terminal state
});

const DEFAULT_GRACEFUL_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESTARTS        = 5;
const DEFAULT_RESTART_BASE_MS     = 200;
const DEFAULT_RESTART_MAX_MS      = 30_000;
const MEM_CHECK_INTERVAL_MS       = 30_000;

// ─── SPAWN STRATEGY ──────────────────────────────────────────
/**
 * Resolve the correct command + args to spawn for a given script.
 *
 *  .sh  → bash  script [args...]
 *  .js  → node  script [args...]
 *  .py  → python3 script [args...]
 *  else → script [args...]   (binary/executable)
 *
 * We NEVER use fork() — agents communicate via filesystem mailboxes,
 * not Node IPC channels, so fork's IPC overhead is wasted and breaks
 * on Node v22+ with explicit stdio array containing 'ipc'.
 */
function resolveSpawnCmd(scriptPath, extraArgs = []) {
    const ext = path.extname(scriptPath).toLowerCase();

    switch (ext) {
        case '.sh':
            return { cmd: 'bash', args: [scriptPath, ...extraArgs] };

        case '.js':
        case '.mjs':
        case '.cjs':
            return { cmd: process.execPath, args: [scriptPath, ...extraArgs] };

        case '.py':
        case '.py3':
            return { cmd: 'python3', args: [scriptPath, ...extraArgs] };

        default:
            // Treat as a self-contained binary / executable wrapper
            return { cmd: scriptPath, args: [...extraArgs] };
    }
}

// ─── LINE BUFFER ─────────────────────────────────────────────
// Accumulate partial lines from stdout/stderr streams so that
// each relay event fires exactly once per newline.
class LineBuffer {
  [key: string]: any;
    #buf;
    #cb;

    constructor(callback) {
        this.#buf = '';
        this.#cb  = callback;
    }

    push(chunk) {
        this.#buf += chunk.toString();
        const lines = this.#buf.split('\n');
        // Everything except the last element is a complete line
        for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i]) this.#cb(lines[i]);
        }
        this.#buf = lines[lines.length - 1];
    }

    flush() {
        if (this.#buf) {
            this.#cb(this.#buf);
            this.#buf = '';
        }
    }
}

// ─── MANAGED PROCESS ─────────────────────────────────────────
class ManagedProcess extends EventEmitter {
  [key: string]: any;
    #id;
    #config;
    #logger;
    #proc;
    #state;
    #restartCount;
    #startTime;
    #lastCrashCode;
    #lastCrashSignal;
    #lastCrashAt;
    #stopRequested;
    #memTimer;
    #restartTimer;

    constructor(id, config, logger) {
        super();
        this.setMaxListeners(100);

        this.#id           = id;
        this.#config       = config;
        this.#logger       = logger;
        this.#proc         = null;
        this.#state        = PROC_STATE.PENDING;
        this.#restartCount = 0;
        this.#startTime    = null;
        this.#lastCrashCode   = null;
        this.#lastCrashSignal = null;
        this.#lastCrashAt  = null;
        this.#stopRequested = false;
        this.#memTimer     = null;
        this.#restartTimer = null;
    }

    // ── ACCESSORS ────────────────────────────────────────────
    get id()    { return this.#id; }
    get state() { return this.#state; }
    get pid()   { return this.#proc?.pid ?? null; }

    // ── STATE MACHINE ────────────────────────────────────────
    #transition(to, meta = {}) {
        const from = this.#state;
        if (from === to) return;

        this.#state = to;

        this.#logger?.info(`Process "${this.#id}": ${from} → ${to}`, {
            pid:      this.pid,
            restarts: this.#restartCount,
            ...meta,
        });

        this.emit('state-change', { id: this.#id, from, to, ...meta });
    }

    // ── START ────────────────────────────────────────────────
    async start() {
        // Guard: already running or permanently failed
        if (this.#state === PROC_STATE.RUNNING ||
            this.#state === PROC_STATE.STARTING) {
            return;
        }

        if (this.#state === PROC_STATE.FAILED) {
            throw new Error(
                `Process "${this.#id}" has permanently failed ` +
                `(${this.#restartCount} restarts). Manual intervention required.`
            );
        }

        this.#stopRequested = false;
        this.#transition(PROC_STATE.STARTING);

        await this.#doSpawn();
    }

    #doSpawn() {
        return new Promise((resolve, reject) => {
            const { script, args = [], cwd, env = {} } = this.#config;
            const { cmd, args: spawnArgs } = resolveSpawnCmd(script, args);

            const spawnEnv = {
                ...process.env,
                ...env,
                // Ensure PATH includes common Termux locations
                PATH: [
                    '/data/data/com.termux/files/usr/bin',
                    '/data/data/com.termux/files/usr/bin/applets',
                    process.env.PATH || '',
                ].join(':'),
            };

            let proc;
            try {
                proc = spawn(cmd, spawnArgs, {
                    cwd:   cwd || process.cwd(),
                    env:   spawnEnv,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    // detached: false — we want to be the parent
                });
            } catch (spawnErr) {
                this.#transition(PROC_STATE.FAILED, { error: spawnErr.message });
                return reject(new Error(
                    `Failed to spawn "${this.#id}": ${spawnErr.message}`
                ));
            }

            this.#proc     = proc;
            this.#startTime = Date.now();

            // ── stdout line relay ─────────────────────────
            const stdoutBuf = new LineBuffer((line) => {
                this.emit('stdout', { id: this.#id, line });
            });
            proc.stdout?.on('data', (chunk) => stdoutBuf.push(chunk));

            // ── stderr line relay ─────────────────────────
            const stderrBuf = new LineBuffer((line) => {
                this.emit('stderr', { id: this.#id, line });
            });
            proc.stderr?.on('data', (chunk) => stderrBuf.push(chunk));

            // ── spawn error (ENOENT, EPERM, etc.) ────────
            proc.on('error', (err) => {
                stdoutBuf.flush();
                stderrBuf.flush();
                this.#stopMemMonitor();

                if (this.#state === PROC_STATE.STARTING) {
                    this.#transition(PROC_STATE.FAILED, { error: err.message });
                    reject(new Error(`Failed to fork "${this.#id}": ${err.message}`));
                } else {
                    this.#logger?.error(`Process "${this.#id}" emitted error`, {
                        error: err.message,
                    });
                    this.emit('error', { id: this.#id, error: err });
                }
            });

            // ── process exit ─────────────────────────────
            proc.on('close', (code, signal) => {
                stdoutBuf.flush();
                stderrBuf.flush();
                this.#stopMemMonitor();

                this.#lastCrashCode   = code;
                this.#lastCrashSignal = signal;
                this.#lastCrashAt     = Date.now();

                if (this.#stopRequested) {
                    // Intentional stop — do not restart
                    this.#transition(PROC_STATE.STOPPED, { code, signal });
                    this.emit('stopped', { id: this.#id, code, signal });
                    return;
                }

                // Unexpected exit
                this.#transition(PROC_STATE.CRASHED, { code, signal });
                this.emit('crash', { id: this.#id, code, signal });
                this.#scheduleRestart(code, signal);
            });

            // ── successful spawn ──────────────────────────
            // Node emits 'spawn' once the child process starts.
            // For older Node versions without 'spawn' event, use a
            // short poll fallback.
            let resolved = false;

            const onSpawn = () => {
                if (resolved) return;
                resolved = true;
                proc.removeListener('error', onEarlyError);
                this.#transition(PROC_STATE.RUNNING, { pid: proc.pid });
                this.#startMemMonitor();
                // @ts-ignore
                resolve();
            };

            const onEarlyError = (err) => {
                if (resolved) return;
                resolved = true;
                // error handler above will handle state transition
            };

            proc.once('spawn', onSpawn);
            proc.once('error', onEarlyError);

            // Fallback for environments where 'spawn' event isn't fired:
            // if the process has a PID assigned and hasn't errored within
            // one tick, treat it as running.
            setImmediate(() => {
                if (!resolved && proc.pid) {
                    onSpawn();
                }
            });
        });
    }

    // ── STOP ─────────────────────────────────────────────────
    async stop(graceful = true) {
        if (
            this.#state === PROC_STATE.STOPPED  ||
            this.#state === PROC_STATE.PENDING   ||
            this.#state === PROC_STATE.FAILED
        ) {
            return;
        }

        // Cancel any pending restart
        if (this.#restartTimer) {
            clearTimeout(this.#restartTimer);
            this.#restartTimer = null;
        }

        this.#stopRequested = true;
        this.#stopMemMonitor();

        if (!this.#proc || this.#proc.exitCode !== null) {
            this.#transition(PROC_STATE.STOPPED);
            return;
        }

        this.#transition(PROC_STATE.STOPPING);

        return new Promise((resolve) => {
            const gracefulMs = this.#config.gracefulTimeout ?? DEFAULT_GRACEFUL_TIMEOUT_MS;

            const cleanup = () => {
                clearTimeout(forceKillTimer);
                // @ts-ignore
                resolve();
            };

            this.#proc.once('close', cleanup);

            if (graceful) {
                // Ask nicely first
                try { this.#proc.kill('SIGTERM'); } catch (_) {}

                // Force kill after timeout
                var forceKillTimer = setTimeout(() => {
                    if (this.#proc && this.#proc.exitCode === null) {
                        this.#logger?.warn(
                            `Process "${this.#id}" did not exit after SIGTERM — sending SIGKILL`
                        );
                        try { this.#proc.kill('SIGKILL'); } catch (_) {}
                    }
                }, gracefulMs);

            } else {
                var forceKillTimer = setTimeout(() => {}, 0);
                try { this.#proc.kill('SIGKILL'); } catch (_) {}
            }
        });
    }

    // ── RESTART WITH EXPONENTIAL BACKOFF ─────────────────────
    #scheduleRestart(code, signal) {
        if (this.#stopRequested) return;

        const maxRestarts = this.#config.maxRestarts ?? DEFAULT_MAX_RESTARTS;

        if (this.#restartCount >= maxRestarts) {
            this.#transition(PROC_STATE.FAILED, {
                reason:   'max_restarts_exceeded',
                restarts: this.#restartCount,
            });
            this.emit('failed', {
                id:           this.#id,
                restartCount: this.#restartCount,
            });
            return;
        }

        this.#restartCount++;

        const delayMs = computeBackoff(
            this.#restartCount - 1,
            this.#config.restartBaseMs  ?? DEFAULT_RESTART_BASE_MS,
            this.#config.restartMaxMs   ?? DEFAULT_RESTART_MAX_MS,
            2
        );

        this.#transition(PROC_STATE.RESTARTING, {
            attempt:   this.#restartCount,
            maxRestarts,
            delayMs,
            code,
            signal,
        });

        this.emit('restart-scheduled', {
            id:         this.#id,
            attempt:    this.#restartCount,
            maxRestarts,
            delayMs,
        });

        this.#restartTimer = setTimeout(async () => {
            this.#restartTimer = null;
            if (this.#stopRequested) return;

            try {
                await this.#doSpawn();
            } catch (err) {
                this.#logger?.error(
                    `Process "${this.#id}" restart attempt ${this.#restartCount} failed`,
                    { error: err.message }
                );
                // #doSpawn will have transitioned to FAILED if needed
            }
        }, delayMs);
    }

    // ── MEMORY MONITOR ────────────────────────────────────────
    #startMemMonitor() {
        const limitBytes = this.#config.memoryLimit;
        if (!limitBytes) return;

        this.#memTimer = setInterval(() => {
            const pid = this.#proc?.pid;
            if (!pid) return;

            try {
                // /proc/<pid>/statm: pages of virtual/resident/shared/...
                const statm   = fs.readFileSync(`/proc/${pid}/statm`, 'utf8');
                const pages   = parseInt(statm.trim().split(/\s+/)[1], 10);
                const rssBytes = pages * 4096;

                if (rssBytes > limitBytes) {
                    this.#logger?.warn(
                        `Process "${this.#id}" exceeds memory limit`,
                        {
                            rssBytes,
                            limitBytes,
                            pid,
                        }
                    );
                    this.emit('memory-exceeded', {
                        id:        this.#id,
                        rssBytes,
                        limitBytes,
                        pid,
                    });
                }
            } catch (_) {
                // Process may have exited between check and read
            }
        }, MEM_CHECK_INTERVAL_MS);

        this.#memTimer.unref?.();
    }

    #stopMemMonitor() {
        if (this.#memTimer) {
            clearInterval(this.#memTimer);
            this.#memTimer = null;
        }
    }

    // ── STATUS SNAPSHOT ──────────────────────────────────────
    getStatus() {
        return {
            id:               this.#id,
            state:            this.#state,
            pid:              this.pid,
            restartCount:     this.#restartCount,
            maxRestarts:      this.#config.maxRestarts ?? DEFAULT_MAX_RESTARTS,
            uptime:           (this.#state === PROC_STATE.RUNNING && this.#startTime)
                ? Date.now() - this.#startTime
                : 0,
            lastCrashCode:    this.#lastCrashCode,
            lastCrashSignal:  this.#lastCrashSignal,
            lastCrashAt:      this.#lastCrashAt,
            script:           this.#config.script,
            type:             this.#config.type || 'generic',
        };
    }
}

// ─── PROCESS MANAGER ─────────────────────────────────────────
class ProcessManager extends EventEmitter {
  [key: string]: any;
    #processes;
    #logger;

    constructor(logger) {
        super();
        this.#processes = new Map();
        this.#logger    = logger;
    }

    // ── REGISTER ─────────────────────────────────────────────
    register(id, config) {
        if (this.#processes.has(id)) {
            throw new Error(`ProcessManager: duplicate registration for "${id}"`);
        }

        const proc = new ManagedProcess(id, config, this.#logger);

        // Bubble events to manager level
        proc.on('state-change',      (d) => this.emit('state-change', d));
        proc.on('crash',             (d) => this.emit('crash', d));
        proc.on('failed',            (d) => this.emit('failed', d));
        proc.on('stopped',           (d) => this.emit('stopped', d));
        proc.on('restart-scheduled', (d) => this.emit('restart-scheduled', d));
        proc.on('memory-exceeded',   (d) => this.emit('memory-exceeded', d));
        proc.on('stdout',            (d) => this.emit('stdout', d));
        proc.on('stderr',            (d) => this.emit('stderr', d));

        this.#processes.set(id, proc);
        this.#logger?.info(`ProcessManager: registered "${id}"`, {
            script: config.script,
            type:   config.type,
        });

        return proc;
    }

    // ── START ─────────────────────────────────────────────────
    async start(id) {
        const proc = this.#require(id);
        await proc.start();
        return proc;
    }

    // ── STOP ──────────────────────────────────────────────────
    async stop(id, graceful = true) {
        const proc = this.#require(id);
        await proc.stop(graceful);
        return proc;
    }

    // ── STOP ALL ──────────────────────────────────────────────
    async stopAll(graceful = true) {
        const results = await Promise.allSettled(
            [...this.#processes.values()].map((p) => p.stop(graceful))
        );

        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                this.#logger?.error(`stopAll: error stopping process`, {
                    error: r.reason?.message,
                });
            }
        });
    }

    // ── BROADCAST ─────────────────────────────────────────────
    broadcast(message) {
        // Shell-agent friendly: write to each agent's stdin if open
        // (Currently agents communicate via mailbox files, not stdin)
        this.emit('broadcast', message);
    }

    // ── STATUS ────────────────────────────────────────────────
    getStatus() {
        const result = {};
        for (const [id, proc] of this.#processes) {
            result[id] = proc.getStatus();
        }
        return result;
    }

    // ── PRIVATE ───────────────────────────────────────────────
    #require(id) {
        const proc = this.#processes.get(id);
        if (!proc) {
            throw new Error(`ProcessManager: no process registered for "${id}"`);
        }
        return proc;
    }
}

module.exports = { ProcessManager, ManagedProcess, PROC_STATE };


export {};
