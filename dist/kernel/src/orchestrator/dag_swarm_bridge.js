// kernel/src/orchestrator/dag_swarm_bridge.ts
import { MerkleDAGEngine } from '../dag/merkle_engine.js';
import { ContextPruner } from '../pipeline/context_pruner.js';
/**
 * DAG-to-Swarm Bridge for AI Agent Orchestration
 * Converts Merkle DAG state diffs into agent execution payloads
 */
export class DAGSwarmBridge {
    merkleEngine;
    contextPruner;
    listeners;
    config;
    taskCounter = 0;
    eventCounter = 0;
    telemetryBuffer = [];
    maxTelemetryBuffer = 1000;
    constructor(merkleEngine, contextPruner, config = {}) {
        this.merkleEngine = merkleEngine ?? new MerkleDAGEngine();
        this.contextPruner = contextPruner ?? new ContextPruner();
        this.listeners = new Set();
        this.config = {
            maxContextDepth: config.maxContextDepth ?? 3,
            maxTokensPerPayload: config.maxTokensPerPayload ?? 4000,
            enableSmartPruning: config.enableSmartPruning ?? true,
            batchDispatch: config.batchDispatch ?? true,
            telemetryEnabled: config.telemetryEnabled ?? true
        };
    }
    /**
     * Intercepts DAG state change and dispatches to swarm agents
     */
    async dispatchDiff(oldRoot, newRoot) {
        const startTime = performance.now();
        // Compute DAG diff
        const diffResult = this.merkleEngine.computeDiff(oldRoot, newRoot);
        // Generate agent payloads
        const payloadStartTime = performance.now();
        const payloads = await this.generateAgentPayloads(diffResult, newRoot);
        const payloadGenerationMs = performance.now() - payloadStartTime;
        // Build dispatch event
        const event = {
            eventId: this.generateEventId(),
            timestamp: Date.now(),
            payloads,
            diffSummary: {
                addedCount: diffResult.added.length,
                modifiedCount: diffResult.modified.length,
                deletedCount: diffResult.deleted.length,
                unchangedCount: diffResult.unchangedHashes.length
            },
            metrics: {
                dispatchLatencyMs: performance.now() - startTime,
                contextPruningMs: 0, // Updated in payload generation
                payloadGenerationMs,
                totalTokens: payloads.reduce((sum, p) => sum + p.tokenEstimate, 0),
                payloadCount: payloads.length,
                averageContextSize: payloads.length > 0
                    ? payloads.reduce((sum, p) => sum + p.context.size, 0) / payloads.length
                    : 0,
                pruningRatio: 0 // Updated in payload generation
            }
        };
        // Update telemetry
        if (this.config.telemetryEnabled) {
            this.recordTelemetry(event.metrics);
        }
        // Dispatch to listeners
        await this.notifyListeners(event);
        return event;
    }
    /**
     * Generates agent execution payloads from diff result
     */
    async generateAgentPayloads(diffResult, newRoot) {
        const payloads = [];
        // Process added files
        for (const addedNode of diffResult.added) {
            if (addedNode.content !== null) {
                const payload = await this.createPayload(addedNode, 'added', newRoot);
                payloads.push(payload);
            }
        }
        // Process modified files
        for (const modified of diffResult.modified) {
            if (modified.newNode.content !== null) {
                const payload = await this.createPayload(modified.newNode, 'modified', newRoot, modified.patchContext);
                payloads.push(payload);
            }
        }
        // Process deleted files (minimal payload)
        for (const deletedNode of diffResult.deleted) {
            if (deletedNode.content !== null) {
                const payload = {
                    taskId: this.generateTaskId(),
                    timestamp: Date.now(),
                    changeType: 'deleted',
                    targetFiles: [{
                            path: deletedNode.path,
                            content: '',
                            hash: deletedNode.hash
                        }],
                    context: new Map(),
                    tokenEstimate: 0
                };
                payloads.push(payload);
            }
        }
        return this.config.batchDispatch ? this.optimizePayloads(payloads) : payloads;
    }
    /**
     * Creates agent execution payload with pruned context
     */
    async createPayload(targetNode, changeType, dagRoot, patchContext) {
        const startTime = performance.now();
        let context = new Map();
        let tokenEstimate = 0;
        if (this.config.enableSmartPruning) {
            try {
                const prunedContext = await this.contextPruner.extractPrunedContext(targetNode.path, dagRoot, this.config.maxContextDepth);
                context = prunedContext.prunedFiles;
                tokenEstimate = prunedContext.tokenEstimate;
            }
            catch (error) {
                // Fallback to single file context
                if (targetNode.content !== null) {
                    context.set(targetNode.path, targetNode.content);
                    tokenEstimate = this.estimateTokens(targetNode.content);
                }
            }
        }
        else {
            // Simple context - just the target file
            if (targetNode.content !== null) {
                context.set(targetNode.path, targetNode.content);
                tokenEstimate = this.estimateTokens(targetNode.content);
            }
        }
        // Enforce token limit
        if (tokenEstimate > this.config.maxTokensPerPayload) {
            context = this.truncateContext(context, this.config.maxTokensPerPayload);
            tokenEstimate = this.config.maxTokensPerPayload;
        }
        const payload = {
            taskId: this.generateTaskId(),
            timestamp: Date.now(),
            changeType,
            targetFiles: [{
                    path: targetNode.path,
                    content: targetNode.content ?? '',
                    hash: targetNode.hash,
                    metadata: targetNode.metadata
                }],
            context,
            patchContext,
            tokenEstimate
        };
        return payload;
    }
    /**
     * Optimizes payloads by merging related changes
     */
    optimizePayloads(payloads) {
        // Group payloads by directory
        const grouped = new Map();
        for (const payload of payloads) {
            const dir = this.getDirectory(payload.targetFiles[0].path);
            if (!grouped.has(dir)) {
                grouped.set(dir, []);
            }
            grouped.get(dir).push(payload);
        }
        const optimized = [];
        for (const [dir, dirPayloads] of grouped.entries()) {
            if (dirPayloads.length === 1) {
                optimized.push(dirPayloads[0]);
                continue;
            }
            // Try to merge payloads in the same directory
            let mergedContext = new Map();
            let mergedTokens = 0;
            const mergedFiles = [];
            for (const p of dirPayloads) {
                // Add context
                for (const [path, content] of p.context.entries()) {
                    mergedContext.set(path, content);
                }
                mergedFiles.push(...p.targetFiles);
                mergedTokens += p.tokenEstimate;
            }
            // If merged payload is too large, keep separate
            if (mergedTokens > this.config.maxTokensPerPayload) {
                optimized.push(...dirPayloads);
            }
            else {
                // Create merged payload
                optimized.push({
                    taskId: this.generateTaskId(),
                    timestamp: Date.now(),
                    changeType: dirPayloads[0].changeType,
                    targetFiles: mergedFiles,
                    context: mergedContext,
                    tokenEstimate: mergedTokens
                });
            }
        }
        return optimized;
    }
    /**
     * Truncates context to fit within token limit
     */
    truncateContext(context, maxTokens) {
        const truncated = new Map();
        let currentTokens = 0;
        // Prioritize files - target file first, then dependencies
        const sortedEntries = Array.from(context.entries());
        for (const [path, content] of sortedEntries) {
            const tokens = this.estimateTokens(content);
            if (currentTokens + tokens <= maxTokens) {
                truncated.set(path, content);
                currentTokens += tokens;
            }
            else {
                // Add truncated version if space remains
                const remainingTokens = maxTokens - currentTokens;
                if (remainingTokens > 100) {
                    const truncatedContent = content.slice(0, remainingTokens * 4);
                    truncated.set(path, truncatedContent + '\n... [truncated]');
                }
                break;
            }
        }
        return truncated;
    }
    /**
     * Estimates token count (4 chars per token heuristic)
     */
    estimateTokens(content) {
        return Math.ceil(content.length / 4);
    }
    /**
     * Gets directory from file path
     */
    getDirectory(path) {
        const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return lastSlash > 0 ? path.slice(0, lastSlash) : '';
    }
    /**
     * Generates unique task ID
     */
    generateTaskId() {
        return `task_${Date.now()}_${this.taskCounter++}`;
    }
    /**
     * Generates unique event ID
     */
    generateEventId() {
        return `event_${Date.now()}_${this.eventCounter++}`;
    }
    /**
     * Records telemetry metrics
     */
    recordTelemetry(metrics) {
        this.telemetryBuffer.push(metrics);
        // Maintain buffer size
        if (this.telemetryBuffer.length > this.maxTelemetryBuffer) {
            this.telemetryBuffer.shift();
        }
    }
    /**
     * Notifies all registered listeners
     */
    async notifyListeners(event) {
        const promises = [];
        for (const listener of this.listeners) {
            try {
                const result = listener(event);
                if (result instanceof Promise) {
                    promises.push(result);
                }
            }
            catch (error) {
                // Listener errors should not break dispatch
                console.error('Listener error:', error);
            }
        }
        await Promise.allSettled(promises);
    }
    /**
     * Registers event listener for swarm dispatches
     */
    onDispatch(listener) {
        this.listeners.add(listener);
        // Return unsubscribe function
        return () => {
            this.listeners.delete(listener);
        };
    }
    /**
     * Removes all event listeners
     */
    clearListeners() {
        this.listeners.clear();
    }
    /**
     * Gets aggregated telemetry metrics
     */
    getTelemetryStats() {
        if (this.telemetryBuffer.length === 0) {
            return {
                avgDispatchLatency: 0,
                avgContextPruning: 0,
                avgPayloadGeneration: 0,
                avgTokensPerEvent: 0,
                avgPayloadsPerEvent: 0,
                totalEvents: 0
            };
        }
        const sum = this.telemetryBuffer.reduce((acc, m) => ({
            dispatchLatencyMs: acc.dispatchLatencyMs + m.dispatchLatencyMs,
            contextPruningMs: acc.contextPruningMs + m.contextPruningMs,
            payloadGenerationMs: acc.payloadGenerationMs + m.payloadGenerationMs,
            totalTokens: acc.totalTokens + m.totalTokens,
            payloadCount: acc.payloadCount + m.payloadCount
        }), {
            dispatchLatencyMs: 0,
            contextPruningMs: 0,
            payloadGenerationMs: 0,
            totalTokens: 0,
            payloadCount: 0
        });
        const count = this.telemetryBuffer.length;
        return {
            avgDispatchLatency: sum.dispatchLatencyMs / count,
            avgContextPruning: sum.contextPruningMs / count,
            avgPayloadGeneration: sum.payloadGenerationMs / count,
            avgTokensPerEvent: sum.totalTokens / count,
            avgPayloadsPerEvent: sum.payloadCount / count,
            totalEvents: count
        };
    }
    /**
     * Synchronous dispatch for immediate processing
     */
    dispatchDiffSync(oldRoot, newRoot) {
        const startTime = performance.now();
        const diffResult = this.merkleEngine.computeDiff(oldRoot, newRoot);
        // Simplified synchronous payload generation
        const payloads = [];
        for (const addedNode of diffResult.added) {
            if (addedNode.content !== null) {
                payloads.push({
                    taskId: this.generateTaskId(),
                    timestamp: Date.now(),
                    changeType: 'added',
                    targetFiles: [{
                            path: addedNode.path,
                            content: addedNode.content,
                            hash: addedNode.hash,
                            metadata: addedNode.metadata
                        }],
                    context: new Map([[addedNode.path, addedNode.content]]),
                    tokenEstimate: this.estimateTokens(addedNode.content)
                });
            }
        }
        for (const modified of diffResult.modified) {
            if (modified.newNode.content !== null) {
                payloads.push({
                    taskId: this.generateTaskId(),
                    timestamp: Date.now(),
                    changeType: 'modified',
                    targetFiles: [{
                            path: modified.newNode.path,
                            content: modified.newNode.content,
                            hash: modified.newNode.hash,
                            metadata: modified.newNode.metadata
                        }],
                    context: new Map([[modified.newNode.path, modified.newNode.content]]),
                    patchContext: modified.patchContext,
                    tokenEstimate: this.estimateTokens(modified.newNode.content)
                });
            }
        }
        const event = {
            eventId: this.generateEventId(),
            timestamp: Date.now(),
            payloads,
            diffSummary: {
                addedCount: diffResult.added.length,
                modifiedCount: diffResult.modified.length,
                deletedCount: diffResult.deleted.length,
                unchangedCount: diffResult.unchangedHashes.length
            },
            metrics: {
                dispatchLatencyMs: performance.now() - startTime,
                contextPruningMs: 0,
                payloadGenerationMs: 0,
                totalTokens: payloads.reduce((sum, p) => sum + p.tokenEstimate, 0),
                payloadCount: payloads.length,
                averageContextSize: payloads.length > 0
                    ? payloads.reduce((sum, p) => sum + p.context.size, 0) / payloads.length
                    : 0,
                pruningRatio: 0
            }
        };
        if (this.config.telemetryEnabled) {
            this.recordTelemetry(event.metrics);
        }
        // Notify listeners synchronously
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (error) {
                console.error('Listener error:', error);
            }
        }
        return event;
    }
    /**
     * Updates bridge configuration
     */
    updateConfig(config) {
        this.config = {
            ...this.config,
            ...config
        };
    }
    /**
     * Gets current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Resets telemetry buffer
     */
    resetTelemetry() {
        this.telemetryBuffer = [];
    }
    /**
     * Gets raw telemetry buffer
     */
    getRawTelemetry() {
        return [...this.telemetryBuffer];
    }
}
