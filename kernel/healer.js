// ============================================================
// KLYN AI OS — Self-Healing Engine v1.0.0
//
// Continuously monitors all registered agents and system
// resources. When anomalies are detected it takes autonomous
// corrective actions before alerting a human.
//
// Healing actions (in order of escalation):
//   1. WARN          — log and emit metric
//   2. MAILBOX_FLUSH — clear a clogged agent mailbox
//   3. RESTART       — send restart request via IPC
//   4. KERNEL_ALERT  — emit to orchestrator for escalation
//
// Runs as a lightweight Node.js module, not a separate process.
// Attach it to the orchestrator after boot completes.
// ============================================================

'use strict';

const fs               = require('fs');
const path             = require('path');
const { EventEmitter } = require('events');

// ─── THRESHOLDS ──────────────────────────────────────────────
const THRESHOLDS = Object.freeze({
    // Agent crash count before triggering heal
    CRASH_COUNT_WARN:     2,
    CRASH_COUNT_RESTART:  3,
    CRASH_COUNT_ALERT:    5,

    // Mailbox depth before flush
    MAILBOX_DEPTH_WARN:   100,
    MAILBOX_DEPTH_FLUSH:  500,

    // DLQ depth before clearing
    DLQ_DEPTH_WARN:       20,
    DLQ_DEPTH_CLEAR:      100,

    // Memory utilisation (0–1)
    HEAP_WARN:   0.80,
    HEAP_ALERT:  0.92,

    // System load (load average vs CPU count)
    LOAD_WARN:  2.0,
    LOAD_ALERT: 4.0,
});

// ─── HEAL ACTION TYPES ───────────────────────────────────────
const HEAL_ACTION = Object.freeze({
    WARN:          'WARN',
    MAILBOX_FLUSH: 'MAILBOX_FLUSH',
    DLQ_CLEAR:     'DLQ_CLEAR',
    RESTART:       'RESTART',
    KERNEL_ALERT:  'KERNEL_ALERT',
    GC:            'GC',              // Force garbage collection if --expose-gc
});

// ─── HEALING RECORD ──────────────────────────────────────────
class HealingRecord {
    #entries;
    #maxEntries;

    constructor(maxEntries = 500) {
        this.#entries    = [];
        this.#maxEntries = maxEntries;
    }

    add(action, target, reason, detail = {}) {
        const entry = {
            ts:     new Date().toISOString(),
            action,
            target,
            reason,
            ...detail,
        };
        this.#entries.push(entry);
        if (this.#entries.length > this.#maxEntries) {
            this.#entries.shift();
        }
        return entry;
    }

    getRecent(n = 20) {
        return this.#entries.slice(-n);
    }

    countByTarget(target) {
        return this.#entries.filter((e) => e.target === target).length;
    }

    getSummary() {
        const byAction = {};
        for (const e of this.#entries) {
            byAction[e.action] = (byAction[e.action] || 0) + 1;
        }
        return {
            total:    this.#entries.length,
            byAction,
            recent:   this.getRecent(5),
        };
    }
}

// ─── SELF-HEALING ENGINE ─────────────────────────────────────
class SelfHealingEngine extends EventEmitter {
    #orchestrator;
    #logger;
    #intervalMs;
    #timer;
    #running;
    #record;
    #cpuCount;

    constructor(orchestrator, logger, options = {}) {
        super();

        this.#orchestrator = orchestrator;
        this.#logger       = logger;
        this.#intervalMs   = options.intervalMs || 15_000;   // Check every 15s
        this.#running      = false;
        this.#timer        = null;
        this.#record       = new HealingRecord();
        this.#cpuCount     = require('os').cpus().length || 1;
    }

    // ── START / STOP ──────────────────────────────────────────
    start() {
        if (this.#running) return;
        this.#running = true;
        this.#logger?.info('Self-healing engine started', {
            intervalMs: this.#intervalMs,
        });
        this.#schedule();
    }

    stop() {
        this.#running = false;
        if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
        this.#logger?.info('Self-healing engine stopped');
    }

    // ── SCHEDULE ─────────────────────────────────────────────
    #schedule() {
        if (!this.#running) return;
        this.#timer = setTimeout(async () => {
            try {
                await this.#runHealCycle();
            } catch (err) {
                this.#logger?.error('Heal cycle error', { error: err.message });
            } finally {
                this.#schedule();
            }
        }, this.#intervalMs);
        this.#timer.unref?.();
    }

    // ── HEAL CYCLE ───────────────────────────────────────────
    async #runHealCycle() {
        const status = this.#orchestrator.getStatus();

        await Promise.all([
            this.#healProcesses(status.processes, status.crashes),
            this.#healMailboxes(status.mailboxes),
            this.#healMemory(status.metrics),
            this.#healSystemLoad(),
        ]);
    }

    // ── PROCESS HEALING ──────────────────────────────────────
    async #healProcesses(processes = {}, crashes = {}) {
        for (const [id, proc] of Object.entries(processes)) {
            const crashInfo = crashes[id] || { count: 0 };
            const count     = crashInfo.count || 0;

            // Crashed but not yet at max restarts
            if (proc.state === 'CRASHED') {
                if (count >= THRESHOLDS.CRASH_COUNT_ALERT) {
                    await this.#act(HEAL_ACTION.KERNEL_ALERT, id,
                        `Agent '${id}' crashed ${count} times`, { count });
                } else if (count >= THRESHOLDS.CRASH_COUNT_RESTART) {
                    await this.#act(HEAL_ACTION.RESTART, id,
                        `Agent '${id}' crashed ${count} times — auto-restarting`, { count });
                    try {
                        await this.#orchestrator.restartAgent(id);
                        this.#logger?.info(`Healer restarted agent: ${id}`);
                    } catch (err) {
                        this.#logger?.error(`Healer restart failed: ${id}`, {
                            error: err.message,
                        });
                    }
                } else if (count >= THRESHOLDS.CRASH_COUNT_WARN) {
                    await this.#act(HEAL_ACTION.WARN, id,
                        `Agent '${id}' crash count: ${count}`, { count });
                }
            }

            // Stuck in STARTING for too long
            if (proc.state === 'STARTING' && proc.uptime > 30_000) {
                await this.#act(HEAL_ACTION.RESTART, id,
                    `Agent '${id}' stuck in STARTING for >30s`, {});
                try {
                    await this.#orchestrator.restartAgent(id);
                } catch (_) {}
            }
        }
    }

    // ── MAILBOX HEALING ──────────────────────────────────────
    async #healMailboxes(mailboxes = {}) {
        for (const [name, stats] of Object.entries(mailboxes)) {
            const depth    = stats.queueDepth || 0;
            const dlqDepth = stats.dlqDepth   || 0;

            if (depth >= THRESHOLDS.MAILBOX_DEPTH_FLUSH) {
                await this.#act(HEAL_ACTION.MAILBOX_FLUSH, name,
                    `Mailbox '${name}' depth ${depth} exceeds flush threshold`, { depth });

                // Ask the agent to drain via a priority message
                const mb = this.#orchestrator.getMailbox(name);
                if (mb) {
                    await mb.send({
                        type:     'healer:drain-request',
                        from:     'healer',
                        to:       name,
                        priority: 1,   // Highest priority
                        payload:  { reason: 'depth_exceeded', depth },
                        ttl:      60_000,
                    }).catch(() => {});
                }

            } else if (depth >= THRESHOLDS.MAILBOX_DEPTH_WARN) {
                await this.#act(HEAL_ACTION.WARN, name,
                    `Mailbox '${name}' depth warning: ${depth}`, { depth });
            }

            if (dlqDepth >= THRESHOLDS.DLQ_DEPTH_CLEAR) {
                await this.#act(HEAL_ACTION.DLQ_CLEAR, name,
                    `DLQ '${name}' at ${dlqDepth} — clearing`, { dlqDepth });
                const mb = this.#orchestrator.getMailbox(name);
                mb?.clearDLQ?.();
            }
        }
    }

    // ── MEMORY HEALING ────────────────────────────────────────
    async #healMemory(metrics) {
        if (!metrics?.memory) return;

        const { heapUsed, heapTotal } = process.memoryUsage();
        const utilisation = heapUsed / heapTotal;

        if (utilisation >= THRESHOLDS.HEAP_ALERT) {
            await this.#act(HEAL_ACTION.KERNEL_ALERT, 'kernel',
                `Critical heap utilisation: ${(utilisation * 100).toFixed(1)}%`, {
                    heapUsed, heapTotal, utilisation,
                });

            // Try to reclaim memory
            if (global.gc) {
                global.gc();
                this.#logger?.info('Healer: forced GC run');
                await this.#act(HEAL_ACTION.GC, 'kernel',
                    'Forced garbage collection due to high heap', { utilisation });
            }

        } else if (utilisation >= THRESHOLDS.HEAP_WARN) {
            await this.#act(HEAL_ACTION.WARN, 'kernel',
                `High heap utilisation: ${(utilisation * 100).toFixed(1)}%`, {
                    utilisation,
                });
        }
    }

    // ── SYSTEM LOAD HEALING ───────────────────────────────────
    async #healSystemLoad() {
        const [load1] = require('os').loadavg();
        const normalisedLoad = load1 / this.#cpuCount;

        if (normalisedLoad >= THRESHOLDS.LOAD_ALERT) {
            await this.#act(HEAL_ACTION.KERNEL_ALERT, 'system',
                `Critical system load: ${load1.toFixed(2)} (norm: ${normalisedLoad.toFixed(2)})`,
                { load1, normalisedLoad }
            );
        } else if (normalisedLoad >= THRESHOLDS.LOAD_WARN) {
            await this.#act(HEAL_ACTION.WARN, 'system',
                `High system load: ${load1.toFixed(2)}`, { load1, normalisedLoad });
        }
    }

    // ── ACT ───────────────────────────────────────────────────
    async #act(action, target, reason, detail = {}) {
        const entry = this.#record.add(action, target, reason, detail);

        this.#logger?.[action === HEAL_ACTION.KERNEL_ALERT ? 'error' : 'warn'](
            `[HEALER] ${action}: ${target} — ${reason}`,
            detail
        );

        this.emit('heal-action', entry);

        // Persist to heal log
        const healLogPath = this.#orchestrator.getStatus().kernel
            ? path.join(
                process.env.KLYN_ROOT || process.cwd(),
                'runtime', 'logs', 'healer.log'
              )
            : null;

        if (healLogPath) {
            try {
                fs.appendFileSync(
                    healLogPath,
                    JSON.stringify(entry) + '\n',
                    { mode: 0o640 }
                );
            } catch (_) {}
        }
    }

    // ── PUBLIC API ────────────────────────────────────────────
    getRecord() {
        return this.#record.getSummary();
    }

    getThresholds() {
        return { ...THRESHOLDS };
    }
}

module.exports = { SelfHealingEngine, HEAL_ACTION, THRESHOLDS };
