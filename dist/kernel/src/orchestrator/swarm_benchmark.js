import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
export class SwarmBenchmark extends EventEmitter {
    activeSessions = new Map();
    snapshots = [];
    maxBufferCapacity;
    cacheStats = new Map();
    constructor(maxBufferCapacity = 1000) {
        super();
        this.maxBufferCapacity = maxBufferCapacity;
    }
    startSession(sessionId, agentId = 'system-agent') {
        const session = {
            sessionId,
            agentId,
            startTime: performance.now(),
            startMemory: process.memoryUsage().heapUsed,
        };
        this.activeSessions.set(sessionId, session);
        return sessionId;
    }
    endSession(sessionId, tokensProcessed = 0, isCacheHit = false) {
        const session = this.activeSessions.get(sessionId);
        const agentId = session ? session.agentId : 'system-agent';
        const startTime = session ? session.startTime : performance.now();
        const startMemory = session ? session.startMemory : process.memoryUsage().heapUsed;
        const endTime = performance.now();
        const endMemory = process.memoryUsage().heapUsed;
        const executionTimeMs = Number((endTime - startTime).toFixed(2));
        const memoryDeltaBytes = endMemory - startMemory;
        const memoryDeltaMB = Number((memoryDeltaBytes / (1024 * 1024)).toFixed(4));
        const heapUsedMB = Number((endMemory / (1024 * 1024)).toFixed(2));
        const durationSeconds = executionTimeMs / 1000;
        const tokensPerSec = durationSeconds > 0 ? Number((tokensProcessed / durationSeconds).toFixed(2)) : 0;
        const snapshot = {
            sessionId,
            agentId,
            timestamp: Date.now(),
            executionTimeMs,
            durationMs: executionTimeMs,
            memoryDeltaMB,
            heapUsedMB,
            tokensProcessed,
            tokensPerSec,
            isCacheHit,
        };
        this.recordSnapshot(snapshot);
        if (session)
            this.activeSessions.delete(sessionId);
        const agentEvent = {
            agentId,
            executionTimeMs,
            tokensProcessed,
            memoryDeltaMB,
            timestamp: Date.now(),
            success: true,
            tokensPerSecond: tokensPerSec,
        };
        this.emit('benchmark:agent-execution', agentEvent);
        const memSnapshot = this.getCurrentMemoryUsage();
        this.emit('benchmark:memory-snapshot', memSnapshot);
        return snapshot;
    }
    recordSnapshot(snapshot) {
        if (this.snapshots.length >= this.maxBufferCapacity) {
            this.snapshots.shift();
        }
        this.snapshots.push(snapshot);
    }
    getThroughputMetrics() {
        const totalTokens = this.snapshots.reduce((acc, s) => acc + s.tokensProcessed, 0);
        const totalDurationMs = this.snapshots.reduce((acc, s) => acc + s.executionTimeMs, 0);
        const durationSec = totalDurationMs / 1000;
        const tokensPerSec = durationSec > 0 ? Number((totalTokens / durationSec).toFixed(2)) : 0;
        const percentiles = this.getPercentiles();
        return {
            tokensPerSec,
            tokensPerSecond: tokensPerSec,
            tasksPerSecond: durationSec > 0 ? Number((this.snapshots.length / durationSec).toFixed(2)) : 0,
            filesPerSecond: durationSec > 0 ? Number((this.snapshots.length / durationSec).toFixed(2)) : 0,
            avgTaskLatencyMs: this.snapshots.length > 0 ? Number((totalDurationMs / this.snapshots.length).toFixed(2)) : 0,
            p95TaskLatencyMs: percentiles.p95,
            p99TaskLatencyMs: percentiles.p99,
            totalTokens,
            durationSec: Number(durationSec.toFixed(2)),
        };
    }
    getCurrentMemoryUsage() {
        const mem = process.memoryUsage();
        const heapUsedMB = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
        const rssMB = Number((mem.rss / (1024 * 1024)).toFixed(2));
        return {
            heapUsed: heapUsedMB,
            heapUsedMB,
            heapTotal: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
            rss: rssMB,
            rssMB,
            timestamp: Date.now(),
        };
    }
    recordCacheAccess(category, hit) {
        if (!this.cacheStats.has(category)) {
            this.cacheStats.set(category, { hits: 0, misses: 0 });
        }
        const stat = this.cacheStats.get(category);
        if (hit)
            stat.hits++;
        else
            stat.misses++;
    }
    getCacheMetrics(category) {
        if (category && this.cacheStats.has(category)) {
            const stat = this.cacheStats.get(category);
            const total = stat.hits + stat.misses;
            const ratio = total > 0 ? Number(((stat.hits / total) * 100).toFixed(2)) : 0;
            return {
                hits: stat.hits,
                misses: stat.misses,
                ratio,
                totalRequests: total,
                hitRate: ratio,
                cacheName: category,
            };
        }
        let totalHits = 0;
        let totalMisses = 0;
        for (const stat of this.cacheStats.values()) {
            totalHits += stat.hits;
            totalMisses += stat.misses;
        }
        const total = totalHits + totalMisses;
        const ratio = total > 0 ? Number(((totalHits / total) * 100).toFixed(2)) : 0;
        return {
            hits: totalHits,
            misses: totalMisses,
            ratio,
            totalRequests: total,
            hitRate: ratio,
            cacheName: category || 'global',
        };
    }
    getPercentiles(agentId) {
        const filtered = agentId
            ? this.snapshots.filter((s) => s.agentId === agentId)
            : this.snapshots;
        if (filtered.length === 0) {
            return { p50: 0, p90: 0, p95: 0, p99: 0 };
        }
        const sortedLatencies = filtered
            .map((s) => s.executionTimeMs)
            .sort((a, b) => a - b);
        const getPercentileValue = (p) => {
            const index = Math.ceil((p / 100) * sortedLatencies.length) - 1;
            const validIndex = Math.max(0, Math.min(index, sortedLatencies.length - 1));
            return Number(sortedLatencies[validIndex].toFixed(2));
        };
        return {
            p50: getPercentileValue(50),
            p90: getPercentileValue(90),
            p95: getPercentileValue(95),
            p99: getPercentileValue(99),
        };
    }
    getCacheHitRatio(agentId) {
        const filtered = agentId
            ? this.snapshots.filter((s) => s.agentId === agentId)
            : this.snapshots;
        if (filtered.length === 0)
            return 0;
        const hits = filtered.filter((s) => s.isCacheHit).length;
        return Number(((hits / filtered.length) * 100).toFixed(2));
    }
    getSnapshot() {
        return this.exportJSON();
    }
    printReport() {
        console.log(this.getAggregatedReport());
    }
    getAggregatedReport() {
        if (this.snapshots.length === 0) {
            return '[SwarmBenchmark] No telemetry snapshots recorded yet.';
        }
        const agentIds = Array.from(new Set(this.snapshots.map((s) => s.agentId)));
        let report = '=========================================================================\n';
        report += '                       KLYN AI OS - SWARM BENCHMARK REPORT               \n';
        report += '=========================================================================\n';
        report += `Total Snapshots: ${this.snapshots.length} | Ring Buffer Bounds: ${this.maxBufferCapacity}\n\n`;
        report += '-------------------------------------------------------------------------\n';
        report += 'AGENT ID       | SAMPLES | P50 (ms) | P95 (ms) | P99 (ms) | TOKENS/SEC | CACHE HIT %\n';
        report += '-------------------------------------------------------------------------\n';
        for (const agentId of agentIds) {
            const agentSnapshots = this.snapshots.filter((s) => s.agentId === agentId);
            const percentiles = this.getPercentiles(agentId);
            const cacheHitPct = this.getCacheHitRatio(agentId);
            const totalTokens = agentSnapshots.reduce((acc, s) => acc + s.tokensProcessed, 0);
            const totalDurationSec = agentSnapshots.reduce((acc, s) => acc + s.executionTimeMs, 0) / 1000;
            const avgTokensPerSec = totalDurationSec > 0 ? (totalTokens / totalDurationSec).toFixed(1) : '0.0';
            report += `${agentId.padEnd(14)} | ` +
                `${String(agentSnapshots.length).padStart(7)} | ` +
                `${String(percentiles.p50).padStart(8)} | ` +
                `${String(percentiles.p95).padStart(8)} | ` +
                `${String(percentiles.p99).padStart(8)} | ` +
                `${String(avgTokensPerSec).padStart(10)} | ` +
                `${String(cacheHitPct + '%').padStart(11)}\n`;
        }
        report += '-------------------------------------------------------------------------\n';
        return report;
    }
    exportJSON() {
        return {
            bufferSize: this.snapshots.length,
            maxCapacity: this.maxBufferCapacity,
            activeSessionsCount: this.activeSessions.size,
            snapshots: this.snapshots,
            percentiles: this.getPercentiles(),
            cacheHitRatio: this.getCacheHitRatio(),
            throughput: this.getThroughputMetrics(),
            memory: this.getCurrentMemoryUsage(),
        };
    }
}
