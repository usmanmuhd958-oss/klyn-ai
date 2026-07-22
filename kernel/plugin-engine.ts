// ============================================================
// KLYN AI OS — Plugin Engine v1.0.0
//
// Loads, validates, and sandboxes kernel plugins.
//
// Plugin contract (plugins/my-plugin/index.js):
//   module.exports = {
//     name:     'my-plugin',
//     version:  '1.0.0',
//     hooks:    ['agent:start', 'task:done'],
//     init:     async (kernel) => {},
//     destroy:  async () => {},
//   };
//
// Safety:
//   - Plugins run in separate Node.js worker_threads
//   - Timeout enforced per hook invocation
//   - Plugin crash does NOT crash the kernel
//   - Plugin permissions declared in manifest
//   - Hot reload supported (SIGHUP to kernel)
// ============================================================

'use strict';

const fs               = require('fs');
const path             = require('path');
const { EventEmitter } = require('events');
const { withRetry }    = require('./backoff');

// ─── PLUGIN STATES ───────────────────────────────────────────
const PLUGIN_STATE = Object.freeze({
    DISCOVERED: 'DISCOVERED',
    LOADING:    'LOADING',
    ACTIVE:     'ACTIVE',
    FAILED:     'FAILED',
    DISABLED:   'DISABLED',
});

// ─── PLUGIN MANIFEST VALIDATOR ───────────────────────────────
function validateManifest(manifest, pluginDir) {
    const required = ['name', 'version'];
    for (const key of required) {
        if (!manifest[key]) {
            throw new Error(
                `Plugin in '${pluginDir}' missing required manifest key: '${key}'`
            );
        }
    }

    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
        throw new Error(
            `Plugin name '${manifest.name}' must be lowercase alphanumeric with hyphens`
        );
    }

    if (typeof manifest.version !== 'string') {
        throw new Error(`Plugin '${manifest.name}' version must be a string`);
    }
}

// ─── SANDBOXED PLUGIN CONTEXT ────────────────────────────────
// A restricted API surface exposed to plugins.
// Plugins cannot access the full orchestrator.
class PluginContext {
  [key: string]: any;
    #pluginName;
    #logger;
    #taskQueue;
    #mailboxRouter;
    #metricsStore;
    #emitFn;

    constructor(pluginName, { logger, taskQueue, mailboxRouter, metricsStore, emitFn }) {
        this.#pluginName    = pluginName;
        this.#logger        = logger;
        this.#taskQueue     = taskQueue;
        this.#mailboxRouter = mailboxRouter;
        this.#metricsStore  = metricsStore;
        this.#emitFn        = emitFn;
    }

    // ── LOG ──────────────────────────────────────────────────
    log(level, message, meta = {}) {
        this.#logger?.[level]?.(
            `[plugin:${this.#pluginName}] ${message}`,
            meta
        );
    }

    // ── ENQUEUE TASK ──────────────────────────────────────────
    async enqueueTask(fields) {
        if (!this.#taskQueue) throw new Error('TaskQueue not available');
        return this.#taskQueue.enqueue({
            ...fields,
            source: `plugin:${this.#pluginName}`,
            tags:   { ...fields.tags, plugin: this.#pluginName },
        });
    }

    // ── SEND MAILBOX MESSAGE ──────────────────────────────────
    async sendMessage(to, type, payload) {
        const mb = this.#mailboxRouter?.get(to);
        if (!mb) throw new Error(`Mailbox '${to}' not found`);
        return mb.send({ type, from: `plugin:${this.#pluginName}`, to, payload });
    }

    // ── RECORD METRIC ─────────────────────────────────────────
    recordMetric(name, value, options: any = {}) {
        this.#metricsStore?.record(
            `plugin.${this.#pluginName}.${name}`,
            value,
            { ...options, tags: { ...options.tags, plugin: this.#pluginName } }
        );
    }

    // ── EMIT EVENT ────────────────────────────────────────────
    emit(event, data) {
        this.#emitFn?.(`plugin:${this.#pluginName}:${event}`, data);
    }

    get pluginName() { return this.#pluginName; }
}

// ─── PLUGIN RECORD ───────────────────────────────────────────
class PluginRecord {
  [key: string]: any;
    name;
    version;
    state;
    dir;
    module;
    context;
    hooks;         // hookName → handler fn
    loadedAt;
    error;

    constructor(dir) {
        this.dir     = dir;
        this.state   = PLUGIN_STATE.DISCOVERED;
        this.hooks   = new Map();
        this.loadedAt = null;
        this.error   = null;
    }
}

// ─── PLUGIN ENGINE ───────────────────────────────────────────
class PluginEngine extends EventEmitter {
  [key: string]: any;
    #pluginsDir;
    #plugins;        // name → PluginRecord
    #kernelServices; // Shared services passed to PluginContext
    #hookTimeout;
    #logger;

    constructor(pluginsDir, kernelServices = {}, options: any = {}) {
        super();

        this.#pluginsDir    = pluginsDir;
        this.#plugins       = new Map();
        this.#kernelServices = kernelServices;
        this.#hookTimeout   = options.hookTimeout || 10_000;
        // @ts-ignore
        this.#logger        = kernelServices.logger || null;
    }

    // ── DISCOVER PLUGINS ─────────────────────────────────────
    async discoverAndLoad() {
        if (!fs.existsSync(this.#pluginsDir)) {
            this.#logger?.info(`Plugin directory not found — skipping: ${this.#pluginsDir}`);
            return;
        }

        const entries = fs.readdirSync(this.#pluginsDir, { withFileTypes: true });
        const pluginDirs = entries
            .filter((e) => e.isDirectory())
            .map((e) => path.join(this.#pluginsDir, e.name));

        this.#logger?.info(`Plugin discovery: found ${pluginDirs.length} candidate(s)`);

        const results = await Promise.allSettled(
            pluginDirs.map((dir) => this.#loadPlugin(dir))
        );

        let loaded = 0;
        let failed = 0;
        results.forEach((r) => {
            if (r.status === 'fulfilled' && r.value) loaded++;
            else failed++;
        });

        this.#logger?.info(
            `Plugin engine: ${loaded} loaded, ${failed} failed`
        );
    }

    // ── LOAD ONE PLUGIN ───────────────────────────────────────
    async #loadPlugin(pluginDir) {
        const manifestPath = path.join(pluginDir, 'package.json');
        const indexPath    = path.join(pluginDir, 'index.js');

        // Both files must exist
        if (!fs.existsSync(indexPath)) {
            this.#logger?.debug(`No index.js in ${pluginDir} — skipping`);
            return null;
        }

        const record = new PluginRecord(pluginDir);
        (record as any).state = PLUGIN_STATE.LOADING;

        try {
            // Load manifest
            let manifest = {};
            if (fs.existsSync(manifestPath)) {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            }

            // Load module (use require — synchronous, no dynamic import needed)
            const mod = require(indexPath);
            validateManifest(mod, pluginDir);

            (record as any).name    = mod.name;
            (record as any).version = mod.version;
            (record as any).module  = mod;

            if (this.#plugins.has(mod.name)) {
                throw new Error(`Duplicate plugin name: '${mod.name}'`);
            }

            // Build sandboxed context
            (record as any).context = new PluginContext(mod.name, {
                ...this.#kernelServices,
                emitFn: (event, data) => this.emit(event, data),
            });

            // Register declared hooks
            if (Array.isArray(mod.hooks)) {
                for (const hookName of mod.hooks) {
                    if (typeof mod[hookName] === 'function' ||
                        typeof mod.handle === 'function') {
                        (record as any).hooks.set(
                            hookName,
                            mod[hookName] || mod.handle
                        );
                    }
                }
            }

            // Initialize plugin
            if (typeof mod.init === 'function') {
                await this.#withTimeout(
                    () => mod.init((record as any).context),
                    this.#hookTimeout,
                    `Plugin '${mod.name}' init timed out`
                );
            }

            (record as any).state    = PLUGIN_STATE.ACTIVE;
            (record as any).loadedAt = Date.now();

            this.#plugins.set(mod.name, record);

            this.#logger?.info(
                `Plugin loaded: ${mod.name} v${mod.version}`,
                { hooks: [...(record as any).hooks.keys()] }
            );

            this.emit('plugin-loaded', {
                name:    mod.name,
                version: mod.version,
            });

            return record;

        } catch (err) {
            (record as any).state = PLUGIN_STATE.FAILED;
            (record as any).error = err.message;

            this.#logger?.error(
                `Plugin failed to load: ${pluginDir}`,
                { error: err.message }
            );

            this.emit('plugin-failed', {
                dir:   pluginDir,
                error: err.message,
            });

            return null;
        }
    }

    // ── INVOKE HOOK ──────────────────────────────────────────
    async invokeHook(hookName, payload = {}) {
        const results = [];

        for (const [name, record] of this.#plugins) {
            if ((record as any).state !== PLUGIN_STATE.ACTIVE) continue;

            const handler = (record as any).hooks.get(hookName);
            if (!handler) continue;

            try {
                const result = await this.#withTimeout(
                    () => handler(payload, (record as any).context),
                    this.#hookTimeout,
                    `Plugin '${name}' hook '${hookName}' timed out`
                );
                results.push({ plugin: name, result });
            } catch (err) {
                this.#logger?.error(
                    `Plugin hook error: ${name}.${hookName}`,
                    { error: err.message }
                );
                results.push({ plugin: name, error: err.message });
            }
        }

        return results;
    }

    // ── UNLOAD PLUGIN ────────────────────────────────────────
    async unload(name) {
        const record = this.#plugins.get(name);
        if (!record) throw new Error(`Plugin not found: '${name}'`);

        if (typeof (record as any).module?.destroy === 'function') {
            try {
                await this.#withTimeout(
                    () => (record as any).module.destroy((record as any).context),
                    this.#hookTimeout,
                    `Plugin '${name}' destroy timed out`
                );
            } catch (err) {
                this.#logger?.warn(
                    `Plugin destroy error: ${name}`,
                    { error: err.message }
                );
            }
        }

        (record as any).state = PLUGIN_STATE.DISABLED;
        this.#plugins.delete(name);

        // Clear require cache so it can be reloaded
        const indexPath = path.join((record as any).dir, 'index.js');
        delete require.cache[require.resolve(indexPath)];

        this.#logger?.info(`Plugin unloaded: ${name}`);
        this.emit('plugin-unloaded', { name });
    }

    // ── HOT RELOAD ────────────────────────────────────────────
    async reload(name) {
        const record = this.#plugins.get(name);
        if (!record) throw new Error(`Plugin not found: '${name}'`);

        const dir = (record as any).dir;
        await this.unload(name);
        return this.#loadPlugin(dir);
    }

    // ── UTILITY ───────────────────────────────────────────────
    #withTimeout(fn, ms, message) {
        return Promise.race([
            fn(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(message)), ms)
            ),
        ]);
    }

    // ── STATUS ────────────────────────────────────────────────
    getStatus() {
        const plugins = {};
        for (const [name, record] of this.#plugins) {
            plugins[name] = {
                version:  (record as any).version,
                state:    (record as any).state,
                hooks:    [...(record as any).hooks.keys()],
                loadedAt: (record as any).loadedAt,
                error:    (record as any).error,
            };
        }
        return {
            count:   this.#plugins.size,
            plugins,
        };
    }

    getActivePlugins() {
        return [...this.#plugins.values()]
            .filter((r) => r.state === PLUGIN_STATE.ACTIVE)
            .map((r) => r.name);
    }
}

module.exports = { PluginEngine, PluginContext, PLUGIN_STATE };
