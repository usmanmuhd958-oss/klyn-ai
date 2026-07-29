// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// ============================================================
// KLYN AI OS — Metrics Store v1.0.0
//
// Persistent, append-only JSONL metrics store.
// Survives kernel restarts. Provides time-series queries.
//
// Storage format: one JSON object per line (JSONL)
// Rotation: new file per day, max 7 days retained
//
// Features:
//   - Record any named metric with tags
//   - Query by name, time range, and tags
//   - Rolling aggregates (min/max/avg/p95/p99)
//   - Automatic file rotation and pruning
//   - Zero external dependencies
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── METRIC TYPES ────────────────────────────────────────────
const METRIC_TYPE = Object.freeze({
    COUNTER:   'counter',    // Monotonically increasing
    GAUGE:     'gauge',      // Point-in-time value
    HISTOGRAM: 'histogram',  // Distribution of values
    TIMER:     'timer',      // Duration in ms
});

// ─── AGGREGATOR ───────────────────────────────────────────────
function aggregate(values) {
    if (!values.length) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const len    = sorted.length;
    const sum    = sorted.reduce((a, b) => a + b, 0);

    const percentile = (p) => {
        const idx = Math.ceil((p / 100) * len) - 1;
        return sorted[Math.max(0, Math.min(idx, len - 1))];
    };

    return {
        count: len,
        sum,
        min:   sorted[0],
        max:   sorted[len - 1],
        avg:   sum / len,
        p50:   percentile(50),
        p95:   percentile(95),
        p99:   percentile(99),
    };
}

// ─── METRICS STORE ───────────────────────────────────────────
class MetricsStore {
  [key: string]: any;
    #storeDir;
    #maxDays;
    #writeQueue;
    #flushTimer;
    #cache;          // In-memory buffer for fast reads
    #cacheMaxSize;

    constructor(storeDir, options: any = {}) {
        if (!storeDir) throw new Error('MetricsStore: storeDir is required');

        this.#storeDir    = storeDir;
        this.#maxDays     = options.maxDays     || 7;
        this.#writeQueue  = [];
        this.#flushTimer  = null;
        this.#cache       = [];
        this.#cacheMaxSize = options.cacheMaxSize || 10_000;

        this.#ensureDir();
        this.#startFlushLoop();
        this.#schedulePrune();
    }

    // ── RECORD ───────────────────────────────────────────────
    record(name, value, options: any = {}) {
        if (!name || typeof name !== 'string') {
            throw new TypeError('MetricsStore.record: name must be a non-empty string');
        }

        const entry = {
            ts:    Date.now(),
            name,
            value: typeof value === 'number' ? value : parseFloat(value) || 0,
            type:  options.type || METRIC_TYPE.GAUGE,
            tags:  options.tags || {},
            unit:  options.unit || null,
        };

        this.#writeQueue.push(entry);

        // In-memory cache for fast recent queries
        this.#cache.push(entry);
        if (this.#cache.length > this.#cacheMaxSize) {
            this.#cache.shift();
        }

        return entry;
    }

    // Convenience methods
    counter(name, increment = 1, tags = {}) {
        return this.record(name, increment, { type: METRIC_TYPE.COUNTER, tags });
    }

    gauge(name, value, tags = {}) {
        return this.record(name, value, { type: METRIC_TYPE.GAUGE, tags });
    }

    timer(name, durationMs, tags = {}) {
        return this.record(name, durationMs, {
            type: METRIC_TYPE.TIMER, tags, unit: 'ms',
        });
    }

    // ── QUERY ─────────────────────────────────────────────────
    query(options: any = {}) {
        const {
            name,
            fromTs    = Date.now() - 3_600_000,   // last 1 hour default
            toTs      = Date.now(),
            tags      = {},
            limit     = 1000,
            aggregate: doAggregate = false,
        } = options;

        // Filter from in-memory cache first
        let results = this.#cache.filter((e) => {
            if (e.ts < fromTs || e.ts > toTs) return false;
            if (name && e.name !== name)       return false;

            for (const [k, v] of Object.entries(tags)) {
                if (e.tags[k] !== v) return false;
            }

            return true;
        });

        results = results.slice(-limit);

        if (doAggregate && results.length > 0) {
            const values = results.map((e) => e.value);
            return {
                name,
                fromTs,
                toTs,
                count:   results.length,
                stats:   aggregate(values),
            };
        }

        return results;
    }

    // Get the latest value of a named metric
    latest(name, tags = {}) {
        for (let i = this.#cache.length - 1; i >= 0; i--) {
            const e = this.#cache[i];
            if (e.name !== name) continue;
            const tagsMatch = Object.entries(tags).every(([k, v]) => e.tags[k] === v);
            if (tagsMatch) return e;
        }
        return null;
    }

    // Get aggregate summary of all known metric names
    getSummary() {
        const byName = {};
        for (const e of this.#cache) {
            if (!byName[e.name]) {
                byName[e.name] = { count: 0, lastValue: null, lastTs: null, type: e.type };
            }
            byName[e.name].count++;
            byName[e.name].lastValue = e.value;
            byName[e.name].lastTs    = e.ts;
        }
        return {
            metricCount: Object.keys(byName).length,
            sampleCount: this.#cache.length,
            metrics:     byName,
        };
    }

    // ── FLUSH LOOP ────────────────────────────────────────────
    #startFlushLoop() {
        // Flush write queue every 5 seconds
        this.#flushTimer = setInterval(() => {
            this.#flush();
        }, 5_000);
        this.#flushTimer.unref?.();
    }

    #flush() {
        if (this.#writeQueue.length === 0) return;

        const batch     = this.#writeQueue.splice(0);
        const filePath  = this.#todayFilePath();
        const lines     = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';

        try {
            fs.appendFileSync(filePath, lines, { mode: 0o640 });
        } catch (err) {
            process.stderr.write(`[MetricsStore] Flush error: ${err.message}\n`);
            // Re-queue failed entries (up to 500 to prevent memory growth)
            this.#writeQueue.unshift(...batch.slice(-500));
        }
    }

    // ── FILE MANAGEMENT ───────────────────────────────────────
    #todayFilePath() {
        const date = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
        return path.join(this.#storeDir, `metrics-${date}.jsonl`);
    }

    #ensureDir() {
        if (!fs.existsSync(this.#storeDir)) {
            fs.mkdirSync(this.#storeDir, { recursive: true, mode: 0o750 });
        }
    }

    #schedulePrune() {
        // Prune once at startup, then daily
        this.#prune();
        setInterval(() => this.#prune(), 24 * 60 * 60 * 1000).unref?.();
    }

    #prune() {
        try {
            const files = fs.readdirSync(this.#storeDir)
                .filter((f) => f.startsWith('metrics-') && f.endsWith('.jsonl'))
                .sort()
                .reverse();  // Newest first

            const toDelete = files.slice(this.#maxDays);
            for (const f of toDelete) {
                fs.unlinkSync(path.join(this.#storeDir, f));
            }

            if (toDelete.length > 0) {
                process.stdout.write(
                    `[MetricsStore] Pruned ${toDelete.length} old metric file(s)\n`
                );
            }
        } catch (err) {
            process.stderr.write(`[MetricsStore] Prune error: ${err.message}\n`);
        }
    }

    // ── CLOSE ─────────────────────────────────────────────────
    close() {
        if (this.#flushTimer) {
            clearInterval(this.#flushTimer);
            this.#flushTimer = null;
        }
        this.#flush();  // Final flush
    }
}

module.exports = { MetricsStore, METRIC_TYPE, aggregate };


export {};
