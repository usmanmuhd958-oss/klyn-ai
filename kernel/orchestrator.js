// ============================================================
// KLYN AI OS — Master Kernel Orchestrator v3.1.0
// Full replacement — incorporates all fixes
// ============================================================

'use strict';

const path             = require('path');
const fs               = require('fs');
const os               = require('os');
const { EventEmitter } = require('events');

const { createLogger }   = require('./logger');
const { ProcessManager, PROC_STATE } = require('./process-manager');
const { MailboxRouter, PRIORITY }    = require('./ipc-mailbox');
const { registry: cbRegistry }       = require('./backoff');

const ORCHESTRATOR_VERSION = '3.1.0';

const BOOT_PHASE = Object.freeze({
    NONE:      0,
    MAILBOX:   1,
    PROCESSES: 2,
    HEALTH:    3,
    READY:     4,
});

const SHUTDOWN_REASON = Object.freeze({
    SIGTERM:  'SIGTERM',
    SIGINT:   'SIGINT',
    SIGHUP:   'SIGHUP',
    FATAL:    'FATAL',
    API:      'API',
    WATCHDOG: 'WATCHDOG',
});

// ─── METRICS COLLECTOR ───────────────────────────────────────
class MetricsCollector {
    #samples;
    #maxSamples;
    #startTime;

    constructor(maxSamples = 720) {
        this.#samples    = [];
        this.#maxSamples = maxSamples;
        this.#startTime  = Date.now();
    }

    record() {
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();
        const sample = {
            ts:     Date.now(),
            uptime: Date.now() - this.#startTime,
            memory: {
                rss:          mem.rss,
                heapUsed:     mem.heapUsed,
                heapTotal:    mem.heapTotal,
                external:     mem.external,
                arrayBuffers: mem.arrayBuffers,
            },
            cpu: { user: cpu.user, system: cpu.system },
            system: {
                loadAvg:  os.loadavg(),
                freeMem:  os.freemem(),
                totalMem: os.totalmem(),
            },
        };
        this.#samples.push(sample);
        if (this.#samples.length > this.#maxSamples) this.#samples.shift();
        return sample;
    }

    getSummary() {
        if (!this.#samples.length) return null;
        const latest   = this.#samples.at(-1);
        const rssVals  = this.#samples.map((s) => s.memory.rss);
        return {
            uptime:      Date.now() - this.#startTime,
            sampleCount: this.#samples.length,
            memory: {
                current: latest.memory.rss,
                peak:    Math.max(...rssVals),
                average: Math.round(rssVals.reduce((a, b) => a + b, 0) / rssVals.length),
            },
            system: latest.system,
            cpu:    latest.cpu,
        };
    }

    getLatest() { return this.#samples.at(-1) ?? null; }
}

// ─── WATCHDOG ────────────────────────────────────────────────
class Watchdog {
    #intervalMs;
    #threshold;
    #onExpiry;
    #lastFeed;
    #timer;
    #active;

    constructor({ intervalMs = 60_000, threshold = 3, onExpiry = () => {} } = {}) {
        this.#intervalMs = intervalMs;
        this.#threshold  = threshold;
        this.#onExpiry   = onExpiry;
        this.#lastFeed   = Date.now();
        this.#active     = false;
        this.#timer      = null;
    }

    start()  { this.#active = true; this.#lastFeed = Date.now(); this.#tick(); }
    feed()   { this.#lastFeed = Date.now(); }
    stop()   { this.#active = false; clearTimeout(this.#timer); this.#timer = null; }

    #tick() {
        if (!this.#active) return;
        this.#timer = setTimeout(() => {
            const elapsed    = Date.now() - this.#lastFeed;
            const maxSilence = this.#intervalMs * this.#threshold;
            if (elapsed > maxSilence) {
                this.#onExpiry({ elapsed, maxSilence });
            }
            this.#tick();
        }, this.#intervalMs);
        this.#timer.unref?.();
    }
}

// ─── ORCHESTRATOR ────────────────────────────────────────────
class KlynOrchestrator extends EventEmitter {
    #config;
    #logger;
    #processManager;
    #mailboxRouter;
    #kernelMailbox;
    #metrics;
    #watchdog;
    #bootPhase;
    #bootTime;
    #shutdownInProgress;
    #metricsTimer;
    #healthTimer;
    #agentRegistry;
    #crashManifest;

    constructor(config) {
        super();
        this.setMaxListeners(1000);

        this.#validateConfig(config);
        this.#config = this.#normalizeConfig(config);

        // Logger bootstraps first — everything else depends on it
        this.#logger = createLogger({
            name:        'klyn-orchestrator',
            level:        this.#config.log.level,
            logDir:       this.#config.log.dir,
            maxFileSize:  this.#config.log.maxFileSize,
            maxFiles:     this.#config.log.maxFiles,
            console:      true,
        });

        const pmLogger = createLogger({
            name:    'klyn-process-manager',
            level:   this.#config.log.level,
            logDir:  this.#config.log.dir,
            console: true,
        });

        this.#bootPhase          = BOOT_PHASE.NONE;
        this.#bootTime           = null;
        this.#shutdownInProgress = false;
        this.#agentRegistry      = new Map();
        this.#crashManifest      = new Map();
        this.#metrics            = new MetricsCollector();

        // Pass logger to ProcessManager so it can log state transitions
        this.#processManager = new ProcessManager(pmLogger);
        this.#mailboxRouter  = new MailboxRouter(
            path.join(this.#config.baseDir, 'runtime', 'mailbox')
        );

        this.#watchdog = new Watchdog({
            intervalMs:  this.#config.watchdog.intervalMs,
            threshold:   this.#config.watchdog.missThreshold,
            onExpiry: ({ elapsed, maxSilence }) => {
                this.#logger.error('Watchdog expired — kernel may be deadlocked', {
                    elapsed, maxSilence,
                });
                this.#triggerShutdown(SHUTDOWN_REASON.WATCHDOG);
            },
        });

        this.#bindProcessManagerEvents();
        this.#registerSignalHandlers();
    }

    // ── CONFIG ───────────────────────────────────────────────
    #validateConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') {
            throw new TypeError('Orchestrator config must be a non-null object');
        }
        cfg.name = cfg.name || 'klyn-kernel';
        cfg.baseDir = cfg.baseDir || process.cwd();
        for (const key of ['name', 'baseDir']) {
            if (!cfg[key]) throw new Error(`Config missing required key: '${key}'`);
        }
        if (!path.isAbsolute(cfg.baseDir)) {
            throw new Error(`config.baseDir must be absolute. Got: '${cfg.baseDir}'`);
        }
    }

    #normalizeConfig(raw) {
        return {
            name:        raw.name,
            version:     raw.version     || '1.0.0',
            environment: raw.environment || 'production',
            baseDir:     raw.baseDir,

            log: {
                level:       raw.log?.level       || 'info',
                dir:         raw.log?.dir
                    || path.join(raw.baseDir, 'runtime', 'logs'),
                maxFileSize: raw.log?.maxFileSize  || 50 * 1024 * 1024,
                maxFiles:    raw.log?.maxFiles     || 10,
            },

            mailbox: {
                pollMs:           raw.mailbox?.pollMs           || 100,
                cleanupIntervalMs: raw.mailbox?.cleanupIntervalMs || 3_600_000,
            },

            health: {
                intervalMs:        raw.health?.intervalMs        || 30_000,
                metricsIntervalMs: raw.health?.metricsIntervalMs || 5_000,
            },

            watchdog: {
                intervalMs:    raw.watchdog?.intervalMs    || 30_000,
                missThreshold: raw.watchdog?.missThreshold || 3,
            },

            shutdown: {
                drainTimeoutMs: raw.shutdown?.drainTimeoutMs || 30_000,
                forceTimeoutMs: raw.shutdown?.forceTimeoutMs || 10_000,
            },

            agents: Array.isArray(raw.agents) ? raw.agents : [],
        };
    }

    // ── BOOT ─────────────────────────────────────────────────
    async boot() {
        this.#bootTime = Date.now();

        this.#logger.info('╔══════════════════════════════════════════════╗');
        this.#logger.info(`║  KLYN AI OS Kernel  v${ORCHESTRATOR_VERSION.padEnd(24)}║`);
        this.#logger.info(`║  App: ${this.#config.name.padEnd(37)}║`);
        this.#logger.info(`║  Env: ${this.#config.environment.padEnd(37)}║`);
        this.#logger.info(`║  PID: ${String(process.pid).padEnd(37)}║`);
        this.#logger.info('╚══════════════════════════════════════════════╝');

        try {
            await this.#bootMailbox();
            await this.#bootAgents();
            await this.#bootHealthMonitoring();

            this.#watchdog.start();
            this.#bootPhase = BOOT_PHASE.READY;

            const elapsed = Date.now() - this.#bootTime;

            this.#logger.info(`Kernel READY — boot completed in ${elapsed}ms`, {
                agents: this.#agentRegistry.size,
            });

            this.#logger.audit('Kernel boot complete', {
                version:     ORCHESTRATOR_VERSION,
                environment: this.#config.environment,
                bootMs:      elapsed,
                agents:      [...this.#agentRegistry.keys()],
            });

            this.emit('ready', { bootMs: elapsed });
            return this;

        } catch (err) {
            this.#logger.fatal('Kernel boot FAILED', {
                phase: this.#bootPhase,
                error: err.message,
                stack: err.stack,
            });
            this.emit('boot-error', err);
            throw err;
        }
    }

    // ── PHASE: MAILBOX ───────────────────────────────────────
    async #bootMailbox() {
        this.#bootPhase = BOOT_PHASE.MAILBOX;
        this.#logger.info('Boot phase [MAILBOX]: Initializing IPC router');

        this.#kernelMailbox = this.#mailboxRouter.register('kernel', {
            pollInterval: this.#config.mailbox.pollMs,
        });

        this.#bindKernelHandlers();
        this.#mailboxRouter.startAll();

        this.#logger.info('Boot phase [MAILBOX]: IPC router online');
    }

    // ── PHASE: AGENTS ────────────────────────────────────────
    async #bootAgents() {
        this.#bootPhase = BOOT_PHASE.PROCESSES;
        this.#logger.info(
            `Boot phase [AGENTS]: Registering ${this.#config.agents.length} agent(s)`
        );

        for (const agentCfg of this.#config.agents) {
            await this.#registerAgent(agentCfg);
        }

        const autoStart = this.#config.agents.filter(
            (a) => a.autoStart !== false && this.#agentRegistry.has(a.id)
        );

        this.#logger.info(
            `Boot phase [AGENTS]: Starting ${autoStart.length} auto-start agent(s)`
        );

        if (autoStart.length === 0) {
            this.#logger.warn('No auto-start agents configured — kernel is headless');
            return;
        }

        const results = await Promise.allSettled(
            autoStart.map((a) => this.#processManager.start(a.id))
        );

        let started = 0;
        let failed  = 0;

        results.forEach((result, idx) => {
            const id = autoStart[idx].id;
            if (result.status === 'fulfilled') {
                started++;
                this.#logger.info(`Agent started: ${id}`);
            } else {
                failed++;
                this.#logger.error(`Agent failed to start: ${id}`, {
                    error: result.reason?.message,
                });
            }
        });

        this.#logger.info('Boot phase [AGENTS]: Complete', { started, failed });

        // Only abort if ALL agents failed AND at least one was required
        if (started === 0 && failed === autoStart.length) {
            const anyRequired = autoStart.some(
                (a) => this.#agentRegistry.get(a.id)?.required !== false
            );
            if (anyRequired) {
                throw new Error(
                    `All ${failed} required auto-start agent(s) failed — aborting boot`
                );
            }
            this.#logger.warn('All agents failed but none are marked required — continuing');
        }
    }

    // ── PHASE: HEALTH MONITORING ─────────────────────────────
    async #bootHealthMonitoring() {
        this.#bootPhase = BOOT_PHASE.HEALTH;
        this.#logger.info('Boot phase [HEALTH]: Starting monitors');

        this.#metricsTimer = setInterval(() => {
            const sample = this.#metrics.record();
            this.#watchdog.feed();

            const heapPct = sample.memory.heapUsed / sample.memory.heapTotal;
            if (heapPct > 0.85) {
                this.#logger.warn('High heap utilization', {
                    heapUsed:  sample.memory.heapUsed,
                    heapTotal: sample.memory.heapTotal,
                    pct:       `${(heapPct * 100).toFixed(1)}%`,
                });
            }
        }, this.#config.health.metricsIntervalMs);

        this.#healthTimer = setInterval(
            () => this.#runHealthCheck(),
            this.#config.health.intervalMs
        );

        this.#metricsTimer.unref?.();
        this.#healthTimer.unref?.();

        this.#logger.info('Boot phase [HEALTH]: Monitors active');
    }

    // ── AGENT REGISTRATION ───────────────────────────────────
    async #registerAgent(raw) {
        if (!raw.id || typeof raw.id !== 'string') {
            throw new TypeError(`Agent config missing 'id': ${JSON.stringify(raw)}`);
        }
        if (!raw.script) {
            throw new TypeError(`Agent '${raw.id}' missing 'script'`);
        }
        if (this.#agentRegistry.has(raw.id)) {
            throw new Error(`Duplicate agent id: '${raw.id}'`);
        }

        const scriptPath = path.isAbsolute(raw.script)
            ? raw.script
            : path.join(this.#config.baseDir, raw.script);

        if (!fs.existsSync(scriptPath)) {
            if (raw.required === false) {
                this.#logger.warn(
                    `Optional agent script missing — skipping: ${raw.id}`,
                    { scriptPath }
                );
                return;
            }
            throw new Error(`Agent script not found: ${scriptPath}`);
        }

        const agentLogDir  = path.join(this.#config.log.dir, 'agents', raw.id);
        const agentWorkDir = path.join(this.#config.baseDir, 'agents', 'work', raw.id);

        fs.mkdirSync(agentLogDir,  { recursive: true, mode: 0o750 });
        fs.mkdirSync(agentWorkDir, { recursive: true, mode: 0o750 });

        const cfg = {
            id:              raw.id,
            type:            raw.type            || 'generic',
            script:          scriptPath,
            args:            raw.args            || [],
            cwd:             raw.cwd             || this.#config.baseDir,
            autoStart:       raw.autoStart       !== false,
            required:        raw.required        !== false,
            maxRestarts:     raw.maxRestarts      ?? 5,
            restartBaseMs:   raw.restartDelay     || 200,
            restartMaxMs:    30_000,
            gracefulTimeout: raw.gracefulTimeout  || 15_000,
            memoryLimit:     raw.memoryLimitMb
                ? raw.memoryLimitMb * 1024 * 1024
                : null,
            env: {
                KLYN_ROOT:           this.#config.baseDir,
                KLYN_ENV:            this.#config.environment,
                KLYN_LOG_LEVEL:      this.#config.log.level,
                KLYN_LOG_DIR:        this.#config.log.dir,
                KLYN_MAILBOX_DIR:    path.join(this.#config.baseDir, 'runtime', 'mailbox'),
                KLYN_PROJECT_ROOT:   this.#config.baseDir,
                AGENT_ID:            raw.id,
                AGENT_TYPE:          raw.type   || 'generic',
                AGENT_LOG_DIR:       agentLogDir,
                AGENT_LOG_PATH:      path.join(agentLogDir, `${raw.id}.log`),
                AGENT_WORK_DIR:      agentWorkDir,
                KLYN_LOG_PATH:       path.join(agentLogDir, `${raw.id}.log`),
                ...raw.env,
            },
        };

        this.#agentRegistry.set(raw.id, cfg);
        this.#crashManifest.set(raw.id, { count: 0, lastAt: null });

        const proc = this.#processManager.register(raw.id, cfg);
        this.#logger.info(`Agent registered: ${raw.id}`, {
            type:   cfg.type,
            script: scriptPath,
        });

        return proc;
    }

    // ── PROCESS MANAGER EVENT WIRING ─────────────────────────
    #bindProcessManagerEvents() {
        this.#processManager.on('crash', ({ id, code, signal }) => {
            const manifest = this.#crashManifest.get(id) || { count: 0, lastAt: null };
            manifest.count++;
            manifest.lastAt = new Date().toISOString();
            this.#crashManifest.set(id, manifest);

            this.#logger.error(`Agent crashed: ${id}`, {
                code, signal, crashCount: manifest.count,
            });
            this.emit('agent-crash', { id, code, signal, crashCount: manifest.count });
        });

        this.#processManager.on('failed', ({ id }) => {
            this.#logger.fatal(`Agent permanently failed: ${id}`);
            const cfg = this.#agentRegistry.get(id);
            if (cfg?.required) {
                this.#logger.fatal(`Critical agent failed — initiating shutdown: ${id}`);
                this.#triggerShutdown(SHUTDOWN_REASON.FATAL);
            }
            this.emit('agent-failed', { id });
        });

        this.#processManager.on('restart-scheduled', (data) => {
            this.#logger.warn(
                `Agent "${data.id}" restarting in ${data.delayMs}ms ` +
                `(attempt ${data.attempt}/${data.maxRestarts})`
            );
        });

        this.#processManager.on('memory-exceeded', (data) => {
            this.#logger.error(`Agent "${data.id}" exceeded memory limit`, data);
        });

        // stdout/stderr relay to kernel log
        this.#processManager.on('stdout', ({ id, line }) => {
            this.#logger.debug(`[${id}] ${line}`);
        });

        this.#processManager.on('stderr', ({ id, line }) => {
            this.#logger.warn(`[${id}:stderr] ${line}`);
        });
    }

    // ── KERNEL MAILBOX HANDLERS ──────────────────────────────
    #bindKernelHandlers() {
        const mb = this.#kernelMailbox;

        mb.on('agent:start', async (msg) => {
            const { agentId } = msg.payload;
            try {
                await this.#processManager.start(agentId);
                await mb.reply(msg, { ok: true, agentId });
            } catch (err) {
                await mb.reply(msg, { ok: false, error: err.message });
            }
        });

        mb.on('agent:stop', async (msg) => {
            const { agentId, graceful = true } = msg.payload;
            try {
                await this.#processManager.stop(agentId, graceful);
                await mb.reply(msg, { ok: true, agentId });
            } catch (err) {
                await mb.reply(msg, { ok: false, error: err.message });
            }
        });

        mb.on('agent:restart', async (msg) => {
            const { agentId } = msg.payload;
            try {
                await this.#processManager.stop(agentId, true);
                await new Promise((r) => setTimeout(r, 500));
                await this.#processManager.start(agentId);
                await mb.reply(msg, { ok: true, agentId });
            } catch (err) {
                await mb.reply(msg, { ok: false, error: err.message });
            }
        });

        mb.on('kernel:status', async (msg) => {
            await mb.reply(msg, this.getStatus());
        });

        mb.on('kernel:metrics', async (msg) => {
            await mb.reply(msg, {
                summary:  this.#metrics.getSummary(),
                latest:   this.#metrics.getLatest(),
                circuits: cbRegistry.getAll(),
            });
        });

        mb.on('kernel:shutdown', async (msg) => {
            await mb.reply(msg, { ok: true, accepted: true });
            setImmediate(() => this.#triggerShutdown(SHUTDOWN_REASON.API));
        });

        mb.on('heartbeat', (msg) => {
            this.#watchdog.feed();
            mb.reply(msg, {
                ok:     true,
                ts:     Date.now(),
                uptime: this.#bootTime ? Date.now() - this.#bootTime : 0,
            }).catch(() => {});
        });

        mb.on('alert:bug-found', (msg) => {
            this.#logger.warn('Bug hunter alert received', msg.payload);
            this.emit('bug-found', msg.payload);
        });

        mb.on('dead-letter', ({ message, reason }) => {
            this.#logger.error('Dead-letter message', {
                id: message.id, type: message.type, from: message.from, reason,
            });
        });
    }

    // ── HEALTH CHECKS ────────────────────────────────────────
    #runHealthCheck() {
        const status       = this.#processManager.getStatus();
        const counts       = { running: 0, crashed: 0, failed: 0, total: 0 };

        for (const proc of Object.values(status)) {
            counts.total++;
            if (proc.state === PROC_STATE.RUNNING)  counts.running++;
            if (proc.state === PROC_STATE.CRASHED)  counts.crashed++;
            if (proc.state === PROC_STATE.FAILED)   counts.failed++;
        }

        const openCircuits = Object.entries(cbRegistry.getAll())
            .filter(([, cb]) => cb.state === 'OPEN')
            .map(([name]) => name);

        this.#logger.debug('Health check', { ...counts, openCircuits });

        if (counts.failed > 0) {
            this.#logger.error(`Health: ${counts.failed} permanently-failed agent(s)`);
        }

        this.emit('health', { ...counts, openCircuits });
    }

    // ── SIGNAL HANDLERS ──────────────────────────────────────
    #registerSignalHandlers() {
        process.once('SIGTERM', () => this.#triggerShutdown(SHUTDOWN_REASON.SIGTERM));
        process.once('SIGINT',  () => this.#triggerShutdown(SHUTDOWN_REASON.SIGINT));
        process.once('SIGHUP',  () => this.#triggerShutdown(SHUTDOWN_REASON.SIGHUP));

        process.on('uncaughtException', async (err) => {
            this.#logger.fatal('Uncaught exception', {
                error: err.message, stack: err.stack,
            });
            await this.#triggerShutdown(SHUTDOWN_REASON.FATAL);
        });

        process.on('unhandledRejection', (reason) => {
            this.#logger.error('Unhandled promise rejection', {
                reason: reason instanceof Error ? reason.message : String(reason),
            });
        });
    }

    // ── SHUTDOWN ─────────────────────────────────────────────
    async #triggerShutdown(reason) {
        if (this.#shutdownInProgress) return;
        this.#shutdownInProgress = true;

        this.#logger.info(`Shutdown initiated — reason: ${reason}`);
        this.emit('shutdown-start', { reason });

        clearInterval(this.#metricsTimer);
        clearInterval(this.#healthTimer);
        this.#watchdog.stop();
        this.#mailboxRouter.stopAll();

        this.#logger.audit('Kernel shutdown', { reason });

        try {
            await Promise.race([
                this.#processManager.stopAll(true),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Graceful drain timeout')),
                        this.#config.shutdown.drainTimeoutMs
                    )
                ),
            ]);
            this.#logger.info('All agents stopped gracefully');
        } catch {
            this.#logger.warn('Drain timeout — forcing SIGKILL');
            await this.#processManager.stopAll(false).catch(() => {});
        }

        this.#logger.info('Kernel shutdown complete');
        await this.#logger.flush?.();
        this.emit('shutdown-complete', { reason });
        process.exit(reason === SHUTDOWN_REASON.FATAL ? 1 : 0);
    }

    // ── PUBLIC API ───────────────────────────────────────────
    getStatus() {
        return {
            kernel: {
                name:        this.#config.name,
                version:     ORCHESTRATOR_VERSION,
                environment: this.#config.environment,
                pid:         process.pid,
                uptime:      this.#bootTime ? Date.now() - this.#bootTime : 0,
                bootPhase:   this.#bootPhase,
                ready:       this.#bootPhase === BOOT_PHASE.READY,
            },
            processes: this.#processManager.getStatus(),
            mailboxes: this.#mailboxRouter.getStats(),
            circuits:  cbRegistry.getAll(),
            metrics:   this.#metrics.getSummary(),
            crashes:   Object.fromEntries(this.#crashManifest),
            node: {
                version:  process.version,
                platform: process.platform,
                arch:     process.arch,
            },
        };
    }

    async startAgent(id)              { return this.#processManager.start(id); }
    async stopAgent(id, g = true)     { return this.#processManager.stop(id, g); }
    async restartAgent(id)            {
        await this.#processManager.stop(id, true);
        await new Promise((r) => setTimeout(r, 500));
        return this.#processManager.start(id);
    }
    getMailbox(name)                  { return this.#mailboxRouter.get(name); }
    isReady()                         { return this.#bootPhase === BOOT_PHASE.READY; }
}

// ─── FACTORY ─────────────────────────────────────────────────
function createOrchestrator(configOrPath) {
    let config;
    if (typeof configOrPath === 'string') {
        const abs = path.resolve(configOrPath);
        if (!fs.existsSync(abs)) throw new Error(`Config not found: ${abs}`);
        config = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } else if (typeof configOrPath === 'object' && configOrPath !== null) {
        config = configOrPath;
    } else {
        throw new TypeError('createOrchestrator: expected config object or path string');
    }
    return new KlynOrchestrator(config);
}

// ─── ENTRY POINT ─────────────────────────────────────────────
if (require.main === module) {
    const CONFIG_PATH = process.env.KLYN_CONFIG
        || path.join(process.cwd(), 'config', 'kernel.config.json');

    const orchestrator = createOrchestrator(CONFIG_PATH);

    orchestrator.on('ready', ({ bootMs }) => {
        console.log(`\n  ✅  KLYN AI OS kernel ready — boot time: ${bootMs}ms\n`);
    });

    orchestrator.on('agent-failed', ({ id }) => {
        console.error(`\n  ❌  FATAL: Agent '${id}' permanently failed\n`);
    });

    orchestrator.on('bug-found', (payload) => {
        console.warn(`\n  🔴  BUG ALERT: ${JSON.stringify(payload)}\n`);
    });

    orchestrator.on('health', ({ running, failed, openCircuits }) => {
        if (failed > 0 || openCircuits?.length > 0) {
            console.warn(
                `  ⚠️  Health: running=${running} failed=${failed}`,
                openCircuits?.length ? `circuits_open=${openCircuits.join(',')}` : ''
            );
        }
    });

    orchestrator.boot().catch((err) => {
        console.error(`\n  💀  Kernel boot error: ${err.message}\n`);
        process.exit(1);
    });
}

KlynOrchestrator.BOOT_PHASE = BOOT_PHASE;
KlynOrchestrator.SHUTDOWN_REASON = SHUTDOWN_REASON;
module.exports = { Orchestrator: KlynOrchestrator, KlynOrchestrator, BOOT_PHASE, SHUTDOWN_REASON };
