/**
 * @fileoverview SwarmDeltaObserver - Real-time incremental codebase update system
 * @module kernel/orchestrator/swarm_delta_observer
 *
 * Enables real-time delta notifications across Swarm Mesh Agents without full re-indexing.
 * Tracks file mutations, recalculates Merkle DAG hashes, re-parses AST incrementally,
 * and notifies affected agents for context invalidation.
 *
 * @author Klyn AI OS Core Team
 * @version 1.0.0
 */
import { EventEmitter } from 'events';
import { watch } from 'fs';
import { promises as fs } from 'fs';
import { resolve, relative } from 'path';
/* ===========================
 * Main Implementation
 * =========================== */
/**
 * SwarmDeltaObserver - Real-time incremental update system for Swarm Mesh
 *
 * Monitors file mutations, incrementally recalculates Merkle DAG and AST,
 * and notifies affected agents for context invalidation.
 *
 * @example
 * ```typescript
 * const observer = new SwarmDeltaObserver(
 *   merkleDAG,
 *   astGraph,
 *   { workspaceRoot: '/path/to/workspace' }
 * );
 *
 * observer.on('swarm:context-invalidated', (agents, delta) => {
 *   console.log(`Invalidating context for ${agents.length} agents`);
 * });
 *
 * await observer.start();
 *
 * const delta = await observer.handleFileMutation(
 *   'src/auth.ts',
 *   newContent
 * );
 * ```
 */
export class SwarmDeltaObserver extends EventEmitter {
    merkleDAG;
    astGraph;
    config;
    // State management
    agentContexts;
    symbolToAgents;
    fileToSymbols;
    fileToAgents;
    // File watching
    fileWatchers;
    watchDebounceTimers;
    // Delta processing
    deltaQueue;
    processingDeltas;
    batchTimer;
    // Statistics
    stats;
    isStarted;
    isShuttingDown;
    /**
     * Creates a new SwarmDeltaObserver
     *
     * @param merkleDAG - Merkle DAG instance
     * @param astGraph - AST Graph instance
     * @param config - Observer configuration
     */
    constructor(merkleDAG, astGraph, config) {
        super();
        this.merkleDAG = merkleDAG;
        this.astGraph = astGraph;
        this.config = {
            workspaceRoot: resolve(config.workspaceRoot),
            watchPatterns: config.watchPatterns ?? ['**/*.{ts,tsx,js,jsx}'],
            ignorePatterns: config.ignorePatterns ?? [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
            ],
            debounceDelayMs: config.debounceDelayMs ?? 100,
            maxConcurrentDeltas: config.maxConcurrentDeltas ?? 5,
            enableFileSystemWatch: config.enableFileSystemWatch ?? true,
            enableLogging: config.enableLogging ?? false,
            maxSymbolCacheSize: config.maxSymbolCacheSize ?? 10000,
            enableBatching: config.enableBatching ?? true,
            batchWindowMs: config.batchWindowMs ?? 50,
        };
        // Initialize state
        this.agentContexts = new Map();
        this.symbolToAgents = new Map();
        this.fileToSymbols = new Map();
        this.fileToAgents = new Map();
        this.fileWatchers = new Map();
        this.watchDebounceTimers = new Map();
        this.deltaQueue = [];
        this.processingDeltas = new Set();
        this.batchTimer = null;
        this.stats = {
            totalMutations: 0,
            totalDeltas: 0,
            totalInvalidations: 0,
            avgProcessingTimeMs: 0,
        };
        this.isStarted = false;
        this.isShuttingDown = false;
        this.setupErrorHandlers();
    }
    /* ===========================
     * Lifecycle Methods
     * =========================== */
    /**
     * Starts the delta observer
     *
     * @throws {Error} If already started or workspace root doesn't exist
     */
    async start() {
        if (this.isStarted) {
            throw new Error('SwarmDeltaObserver already started');
        }
        this.log('Starting SwarmDeltaObserver...');
        // Validate workspace root
        await this.validateWorkspaceRoot();
        // Initialize file-to-symbols cache
        await this.initializeSymbolCache();
        // Start filesystem watchers if enabled
        if (this.config.enableFileSystemWatch) {
            await this.startFileSystemWatch();
        }
        this.isStarted = true;
        this.log('SwarmDeltaObserver started successfully');
    }
    /**
     * Stops the delta observer and cleans up resources
     */
    async stop() {
        if (!this.isStarted || this.isShuttingDown) {
            return;
        }
        this.log('Stopping SwarmDeltaObserver...');
        this.isShuttingDown = true;
        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        // Clear debounce timers
        for (const timer of this.watchDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this.watchDebounceTimers.clear();
        // Stop file watchers
        for (const watcher of this.fileWatchers.values()) {
            watcher.close();
        }
        this.fileWatchers.clear();
        // Process remaining deltas
        if (this.deltaQueue.length > 0) {
            this.log(`Processing ${this.deltaQueue.length} remaining deltas...`);
            await this.processDeltaBatch();
        }
        // Clear state
        this.agentContexts.clear();
        this.symbolToAgents.clear();
        this.fileToSymbols.clear();
        this.fileToAgents.clear();
        this.deltaQueue = [];
        this.processingDeltas.clear();
        this.isStarted = false;
        this.isShuttingDown = false;
        this.log('SwarmDeltaObserver stopped successfully');
    }
    /* ===========================
     * Public API Methods
     * =========================== */
    /**
     * Handles a file mutation event and calculates delta
     *
     * @param filePath - Path to the mutated file
     * @param content - New file content (undefined for deletions)
     * @param source - Source of mutation (agent ID or 'filesystem')
     * @returns Promise resolving to context delta report
     * @throws {Error} If observer not started or processing fails
     */
    async handleFileMutation(filePath, content, source = 'manual') {
        this.ensureStarted();
        const normalizedPath = this.normalizePath(filePath);
        const mutationType = await this.determineMutationType(normalizedPath, content);
        this.log(`Handling ${mutationType} for ${normalizedPath} (source: ${source})`);
        const job = {
            filePath: normalizedPath,
            content: content ?? '',
            source,
            mutationType,
            timestamp: Date.now(),
        };
        // Process immediately if batching disabled
        if (!this.config.enableBatching) {
            return this.processDeltaJob(job);
        }
        // Add to batch queue
        this.deltaQueue.push(job);
        this.scheduleBatchProcessing();
        // Wait for batch processing to complete
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Delta calculation timeout'));
            }, 30000);
            const handler = (delta) => {
                if (delta.mutation.filePath === normalizedPath) {
                    clearTimeout(timeout);
                    this.off('swarm:delta-calculated', handler);
                    resolve(delta);
                }
            };
            this.on('swarm:delta-calculated', handler);
        });
    }
    /**
     * Gets list of agent IDs affected by mutated symbols
     *
     * @param mutatedSymbols - Array of mutated symbol names
     * @param activeSwarm - Current swarm mesh state
     * @returns Array of affected agent IDs
     */
    getAffectedAgents(mutatedSymbols, activeSwarm) {
        const affectedAgents = new Set();
        for (const symbol of mutatedSymbols) {
            const agents = this.symbolToAgents.get(symbol);
            if (agents) {
                for (const agentId of agents) {
                    // Only include if agent is still active in swarm
                    if (activeSwarm.agents.has(agentId)) {
                        affectedAgents.add(agentId);
                    }
                }
            }
        }
        return Array.from(affectedAgents);
    }
    /**
     * Registers an agent's context for tracking
     *
     * @param metadata - Agent context metadata
     */
    registerAgentContext(metadata) {
        this.ensureStarted();
        this.log(`Registering context for agent ${metadata.agentId}`);
        // Store agent metadata
        this.agentContexts.set(metadata.agentId, metadata);
        // Update symbol -> agents mapping
        for (const symbol of metadata.symbolsInContext) {
            if (!this.symbolToAgents.has(symbol)) {
                this.symbolToAgents.set(symbol, new Set());
            }
            this.symbolToAgents.get(symbol).add(metadata.agentId);
        }
        // Update file -> agents mapping
        for (const filePath of metadata.filePathsInContext) {
            if (!this.fileToAgents.has(filePath)) {
                this.fileToAgents.set(filePath, new Set());
            }
            this.fileToAgents.get(filePath).add(metadata.agentId);
        }
    }
    /**
     * Unregisters an agent's context
     *
     * @param agentId - Agent ID to unregister
     */
    unregisterAgentContext(agentId) {
        const metadata = this.agentContexts.get(agentId);
        if (!metadata) {
            return;
        }
        this.log(`Unregistering context for agent ${agentId}`);
        // Remove from symbol -> agents mapping
        for (const symbol of metadata.symbolsInContext) {
            const agents = this.symbolToAgents.get(symbol);
            if (agents) {
                agents.delete(agentId);
                if (agents.size === 0) {
                    this.symbolToAgents.delete(symbol);
                }
            }
        }
        // Remove from file -> agents mapping
        for (const filePath of metadata.filePathsInContext) {
            const agents = this.fileToAgents.get(filePath);
            if (agents) {
                agents.delete(agentId);
                if (agents.size === 0) {
                    this.fileToAgents.delete(filePath);
                }
            }
        }
        // Remove agent metadata
        this.agentContexts.delete(agentId);
    }
    /**
     * Updates an agent's context (efficient incremental update)
     *
     * @param agentId - Agent ID
     * @param addedFiles - Files added to context
     * @param removedFiles - Files removed from context
     * @param addedSymbols - Symbols added to context
     * @param removedSymbols - Symbols removed from context
     */
    updateAgentContext(agentId, addedFiles = [], removedFiles = [], addedSymbols = [], removedSymbols = []) {
        const metadata = this.agentContexts.get(agentId);
        if (!metadata) {
            throw new Error(`Agent ${agentId} not registered`);
        }
        // Create updated metadata
        const updatedFiles = new Set(metadata.filePathsInContext);
        const updatedSymbols = new Set(metadata.symbolsInContext);
        // Apply file changes
        for (const file of addedFiles) {
            updatedFiles.add(file);
            if (!this.fileToAgents.has(file)) {
                this.fileToAgents.set(file, new Set());
            }
            this.fileToAgents.get(file).add(agentId);
        }
        for (const file of removedFiles) {
            updatedFiles.delete(file);
            const agents = this.fileToAgents.get(file);
            if (agents) {
                agents.delete(agentId);
                if (agents.size === 0) {
                    this.fileToAgents.delete(file);
                }
            }
        }
        // Apply symbol changes
        for (const symbol of addedSymbols) {
            updatedSymbols.add(symbol);
            if (!this.symbolToAgents.has(symbol)) {
                this.symbolToAgents.set(symbol, new Set());
            }
            this.symbolToAgents.get(symbol).add(agentId);
        }
        for (const symbol of removedSymbols) {
            updatedSymbols.delete(symbol);
            const agents = this.symbolToAgents.get(symbol);
            if (agents) {
                agents.delete(agentId);
                if (agents.size === 0) {
                    this.symbolToAgents.delete(symbol);
                }
            }
        }
        // Update metadata
        this.agentContexts.set(agentId, {
            ...metadata,
            filePathsInContext: updatedFiles,
            symbolsInContext: updatedSymbols,
            lastUpdated: Date.now(),
        });
    }
    /**
     * Gets observer statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /* ===========================
     * Delta Calculation Engine
     * =========================== */
    /**
     * Processes a single delta calculation job
     */
    async processDeltaJob(job) {
        const startTime = performance.now();
        try {
            this.processingDeltas.add(job.filePath);
            // Step 1: Get previous state
            const previousState = await this.captureFileState(job.filePath);
            // Step 2: Recalculate Merkle DAG hash
            const merkleDAGDelta = await this.recalculateMerkleDAG(job.filePath, job.content, previousState.hash);
            this.emit('swarm:merkle-updated', merkleDAGDelta);
            // Step 3: Re-parse AST for affected file only
            const astDelta = await this.recalculateAST(job.filePath, job.content, job.mutationType, previousState.symbols);
            this.emit('swarm:ast-updated', astDelta);
            // Step 4: Update internal caches
            await this.updateSymbolCache(job.filePath, astDelta);
            // Step 5: Determine affected files (transitive dependencies)
            const affectedFiles = await this.getAffectedFiles(job.filePath, astDelta);
            // Step 6: Determine affected agents
            const affectedAgents = this.determineAffectedAgents(job.filePath, astDelta, affectedFiles);
            // Step 7: Create mutation event
            const mutationEvent = {
                filePath: job.filePath,
                mutationType: job.mutationType,
                content: job.mutationType !== 'deleted' ? job.content : undefined,
                previousHash: previousState.hash,
                newHash: merkleDAGDelta.newHash,
                timestamp: job.timestamp,
                source: job.source,
            };
            this.emit('swarm:file-mutated', mutationEvent);
            // Step 8: Build delta report
            const processingTimeMs = performance.now() - startTime;
            const deltaReport = {
                mutation: mutationEvent,
                merkleDAGDelta,
                astDelta,
                affectedAgents,
                affectedFiles,
                processingTimeMs,
                timestamp: Date.now(),
                requiresContextRefresh: this.shouldRefreshContext(astDelta),
            };
            // Update statistics
            this.updateStats(processingTimeMs);
            // Emit delta calculated
            this.emit('swarm:delta-calculated', deltaReport);
            // Emit context invalidation if agents affected
            if (affectedAgents.length > 0) {
                this.stats.totalInvalidations++;
                this.emit('swarm:context-invalidated', affectedAgents, deltaReport);
            }
            this.log(`Delta calculated for ${job.filePath}: ` +
                `${affectedAgents.length} agents affected, ` +
                `${processingTimeMs.toFixed(2)}ms`);
            return deltaReport;
        }
        catch (error) {
            const errorMsg = this.getErrorMessage(error);
            this.log(`Error processing delta for ${job.filePath}: ${errorMsg}`);
            this.emit('swarm:error', error instanceof Error ? error : new Error(errorMsg), job);
            throw error;
        }
        finally {
            this.processingDeltas.delete(job.filePath);
        }
    }
    /**
     * Processes batch of delta jobs
     */
    async processDeltaBatch() {
        if (this.deltaQueue.length === 0) {
            return;
        }
        const batch = this.deltaQueue.splice(0, this.config.maxConcurrentDeltas);
        this.log(`Processing batch of ${batch.length} deltas`);
        const startTime = performance.now();
        try {
            const deltaReports = await Promise.all(batch.map(job => this.processDeltaJob(job)));
            const processingTimeMs = performance.now() - startTime;
            this.log(`Batch processed in ${processingTimeMs.toFixed(2)}ms`);
            this.emit('swarm:batch-processed', deltaReports);
            // Schedule next batch if queue not empty
            if (this.deltaQueue.length > 0) {
                this.scheduleBatchProcessing();
            }
        }
        catch (error) {
            this.log(`Error processing batch: ${this.getErrorMessage(error)}`);
            this.emit('swarm:error', error instanceof Error ? error : new Error('Batch processing failed'));
        }
    }
    /**
     * Schedules batch processing with debouncing
     */
    scheduleBatchProcessing() {
        if (this.batchTimer) {
            return; // Already scheduled
        }
        this.batchTimer = setTimeout(() => {
            this.batchTimer = null;
            this.processDeltaBatch().catch(error => {
                this.emit('swarm:error', error instanceof Error ? error : new Error('Batch processing failed'));
            });
        }, this.config.batchWindowMs);
    }
    /* ===========================
     * Merkle DAG Recalculation
     * =========================== */
    /**
     * Recalculates Merkle DAG hash for a file
     */
    async recalculateMerkleDAG(filePath, content, previousHash) {
        const startTime = performance.now();
        // Update file in Merkle DAG
        const newHash = await this.merkleDAG.updateFile(filePath, content);
        // Get affected parent nodes (files that import this file)
        const affectedParents = await this.merkleDAG.getParentNodes(filePath);
        const recalculationTimeMs = performance.now() - startTime;
        return {
            filePath,
            previousHash,
            newHash,
            affectedParents: affectedParents.map(node => node.path),
            recalculationTimeMs,
        };
    }
    /* ===========================
     * AST Recalculation
     * =========================== */
    /**
     * Re-parses AST for a single file and calculates delta
     */
    async recalculateAST(filePath, content, mutationType, previousSymbols) {
        // Handle deletion
        if (mutationType === 'deleted') {
            return this.createDeletionDelta(filePath, previousSymbols);
        }
        // Re-parse AST for this file only
        await this.astGraph.parseFile(filePath);
        // Get new symbols
        const newSymbols = await this.extractSymbols(filePath);
        // Calculate symbol changes
        const symbolChanges = this.calculateSymbolChanges(previousSymbols, newSymbols);
        // Get dependency changes
        const dependencyChanges = await this.calculateDependencyChanges(filePath);
        return {
            filePath,
            addedSymbols: symbolChanges.added,
            modifiedSymbols: symbolChanges.modified,
            removedSymbols: symbolChanges.removed,
            addedDependencies: dependencyChanges.added,
            removedDependencies: dependencyChanges.removed,
            previousSymbolCount: previousSymbols.size,
            newSymbolCount: newSymbols.length,
        };
    }
    /**
     * Creates deletion delta
     */
    createDeletionDelta(filePath, previousSymbols) {
        const removedSymbols = Array.from(previousSymbols).map(symbol => ({
            symbolName: symbol.name,
            filePath,
            changeType: 'removed',
            nodeType: symbol.nodeType,
            previousSignature: symbol.signature,
            isExported: symbol.isExported,
        }));
        return {
            filePath,
            addedSymbols: [],
            modifiedSymbols: [],
            removedSymbols,
            addedDependencies: [],
            removedDependencies: [],
            previousSymbolCount: previousSymbols.size,
            newSymbolCount: 0,
        };
    }
    /**
     * Extracts symbols from a file
     */
    async extractSymbols(filePath) {
        const symbols = [];
        try {
            const astNodes = await this.astGraph.getAllSymbols(filePath);
            for (const node of astNodes) {
                symbols.push({
                    name: node.name ?? 'anonymous',
                    signature: this.extractSignature(node),
                    nodeType: node.kind,
                    isExported: this.isExported(node),
                    filePath,
                });
            }
        }
        catch (error) {
            this.log(`Warning: Failed to extract symbols from ${filePath}`);
        }
        return symbols;
    }
    /**
     * Calculates symbol changes between old and new state
     */
    calculateSymbolChanges(previousSymbols, newSymbols) {
        const added = [];
        const modified = [];
        const removed = [];
        const previousMap = new Map();
        for (const symbol of previousSymbols) {
            previousMap.set(symbol.name, symbol);
        }
        const newMap = new Map();
        for (const symbol of newSymbols) {
            newMap.set(symbol.name, symbol);
        }
        // Find added and modified
        for (const [name, newSymbol] of newMap) {
            const prevSymbol = previousMap.get(name);
            if (!prevSymbol) {
                // Symbol added
                added.push({
                    symbolName: name,
                    filePath: newSymbol.filePath,
                    changeType: 'added',
                    nodeType: newSymbol.nodeType,
                    newSignature: newSymbol.signature,
                    isExported: newSymbol.isExported,
                });
            }
            else if (prevSymbol.signature !== newSymbol.signature) {
                // Symbol modified
                modified.push({
                    symbolName: name,
                    filePath: newSymbol.filePath,
                    changeType: 'modified',
                    nodeType: newSymbol.nodeType,
                    previousSignature: prevSymbol.signature,
                    newSignature: newSymbol.signature,
                    isExported: newSymbol.isExported,
                });
            }
        }
        // Find removed
        for (const [name, prevSymbol] of previousMap) {
            if (!newMap.has(name)) {
                removed.push({
                    symbolName: name,
                    filePath: prevSymbol.filePath,
                    changeType: 'removed',
                    nodeType: prevSymbol.nodeType,
                    previousSignature: prevSymbol.signature,
                    isExported: prevSymbol.isExported,
                });
            }
        }
        return { added, modified, removed };
    }
    /**
     * Calculates dependency changes for a file
     */
    async calculateDependencyChanges(filePath) {
        // This would ideally track previous dependencies
        // For now, return current dependencies as "added"
        try {
            const dependencies = await this.astGraph.getDependencies(filePath);
            return {
                added: Array.from(dependencies || []).map((dep) => typeof dep === "string" ? dep : dep?.target || dep),
                removed: [],
            };
        }
        catch (error) {
            return { added: [], removed: [] };
        }
    }
    /**
     * Extracts signature from AST node
     */
    extractSignature(node) {
        // Extract type signature, excluding implementation
        if (node.text) {
            // Simple heuristic: take everything before opening brace
            const match = node.text.match(/^([^{]+)/);
            if (match) {
                return match[1].trim();
            }
        }
        return `${node.kind} ${node.name ?? 'anonymous'}`;
    }
    /**
     * Checks if AST node is exported
     */
    isExported(node) {
        if (!node.modifiers) {
            return false;
        }
        return node.modifiers.some(mod => mod === 'export' || mod === 'default');
    }
    /* ===========================
     * Affected Files & Agents
     * =========================== */
    /**
     * Gets files affected by a change (transitive dependencies)
     */
    async getAffectedFiles(filePath, astDelta) {
        const affected = new Set();
        // Add the changed file itself
        affected.add(filePath);
        // Add files that import this file (immediate parents)
        try {
            const parents = await this.merkleDAG.getParentNodes(filePath);
            for (const parent of parents) {
                affected.add(parent.path);
            }
        }
        catch (error) {
            this.log(`Warning: Failed to get parent nodes for ${filePath}`);
        }
        // If exported symbols changed, trace through dependency graph
        const hasExportedChanges = [
            ...astDelta.addedSymbols,
            ...astDelta.modifiedSymbols,
            ...astDelta.removedSymbols,
        ].some(change => change.isExported);
        if (hasExportedChanges) {
            try {
                const transitiveAffected = await this.getTransitiveAffectedFiles(filePath);
                for (const file of transitiveAffected) {
                    affected.add(file);
                }
            }
            catch (error) {
                this.log(`Warning: Failed to get transitive affected files for ${filePath}`);
            }
        }
        return Array.from(affected);
    }
    /**
     * Gets transitively affected files via dependency graph
     */
    async getTransitiveAffectedFiles(filePath, maxDepth = 3) {
        const affected = new Set();
        const visited = new Set();
        const traverse = async (currentPath, depth) => {
            if (visited.has(currentPath) || depth >= maxDepth) {
                return;
            }
            visited.add(currentPath);
            try {
                const parents = await this.merkleDAG.getParentNodes(currentPath);
                for (const parent of parents) {
                    affected.add(parent.path);
                    await traverse(parent.path, depth + 1);
                }
            }
            catch (error) {
                // Silently skip
            }
        };
        await traverse(filePath, 0);
        return Array.from(affected);
    }
    /**
     * Determines agents affected by a file change
     */
    determineAffectedAgents(filePath, astDelta, affectedFiles) {
        const affectedAgents = new Set();
        // Method 1: Check agents with this file in context
        const fileAgents = this.fileToAgents.get(filePath);
        if (fileAgents) {
            for (const agentId of fileAgents) {
                affectedAgents.add(agentId);
            }
        }
        // Method 2: Check agents with affected files in context
        for (const affectedFile of affectedFiles) {
            const agents = this.fileToAgents.get(affectedFile);
            if (agents) {
                for (const agentId of agents) {
                    affectedAgents.add(agentId);
                }
            }
        }
        // Method 3: Check agents using changed symbols
        const changedSymbols = [
            ...astDelta.addedSymbols,
            ...astDelta.modifiedSymbols,
            ...astDelta.removedSymbols,
        ].map(change => change.symbolName);
        for (const symbol of changedSymbols) {
            const agents = this.symbolToAgents.get(symbol);
            if (agents) {
                for (const agentId of agents) {
                    affectedAgents.add(agentId);
                }
            }
        }
        return Array.from(affectedAgents);
    }
    /**
     * Determines if context refresh is required
     */
    shouldRefreshContext(astDelta) {
        // Require refresh if exported symbols changed
        const exportedChanges = [
            ...astDelta.addedSymbols,
            ...astDelta.modifiedSymbols,
            ...astDelta.removedSymbols,
        ].filter(change => change.isExported);
        return exportedChanges.length > 0;
    }
    /* ===========================
     * File System Watching
     * =========================== */
    /**
     * Starts filesystem watching
     */
    async startFileSystemWatch() {
        this.log('Starting filesystem watch...');
        try {
            // Watch workspace root recursively
            const watcher = watch(this.config.workspaceRoot, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    this.handleFileSystemEvent(eventType, filename);
                }
            });
            this.fileWatchers.set(this.config.workspaceRoot, watcher);
            this.log('Filesystem watch started');
        }
        catch (error) {
            this.log(`Warning: Failed to start filesystem watch: ${this.getErrorMessage(error)}`);
        }
    }
    /**
     * Handles filesystem events
     */
    handleFileSystemEvent(eventType, filename) {
        const fullPath = resolve(this.config.workspaceRoot, filename);
        const normalizedPath = this.normalizePath(fullPath);
        // Ignore patterns
        if (this.shouldIgnoreFile(normalizedPath)) {
            return;
        }
        // Debounce rapid changes
        this.debounceFileEvent(normalizedPath, eventType);
    }
    /**
     * Debounces file events to avoid processing rapid changes
     */
    debounceFileEvent(filePath, eventType) {
        const existingTimer = this.watchDebounceTimers.get(filePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        const timer = setTimeout(() => {
            this.watchDebounceTimers.delete(filePath);
            this.processFileSystemEvent(filePath, eventType);
        }, this.config.debounceDelayMs);
        this.watchDebounceTimers.set(filePath, timer);
    }
    /**
     * Processes debounced filesystem event
     */
    async processFileSystemEvent(filePath, eventType) {
        try {
            // Read file content
            const content = await fs.readFile(filePath, 'utf-8');
            // Process as mutation
            await this.handleFileMutation(filePath, content, 'filesystem');
        }
        catch (error) {
            // File might have been deleted
            if (error.code === 'ENOENT') {
                await this.handleFileMutation(filePath, undefined, 'filesystem');
            }
            else {
                this.log(`Error processing file event for ${filePath}: ${this.getErrorMessage(error)}`);
            }
        }
    }
    /**
     * Checks if file should be ignored
     */
    shouldIgnoreFile(filePath) {
        const relativePath = relative(this.config.workspaceRoot, filePath);
        // Check ignore patterns
        for (const pattern of this.config.ignorePatterns) {
            if (this.matchesPattern(relativePath, pattern)) {
                return true;
            }
        }
        // Check watch patterns (if specified, only watch matching files)
        if (this.config.watchPatterns.length > 0) {
            let matches = false;
            for (const pattern of this.config.watchPatterns) {
                if (this.matchesPattern(relativePath, pattern)) {
                    matches = true;
                    break;
                }
            }
            if (!matches) {
                return true;
            }
        }
        return false;
    }
    /**
     * Simple glob pattern matching
     */
    matchesPattern(path, pattern) {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.')
            .replace(/\./g, '\\.');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(path);
    }
    /* ===========================
     * State Management
     * =========================== */
    /**
     * Captures current state of a file before mutation
     */
    async captureFileState(filePath) {
        const hash = await this.merkleDAG.getFileHash(filePath).catch(() => undefined);
        const symbols = this.fileToSymbols.get(filePath) ?? new Set();
        return { hash, symbols };
    }
    /**
     * Determines mutation type for a file
     */
    async determineMutationType(filePath, content) {
        const exists = await this.fileExists(filePath);
        if (content === undefined) {
            return 'deleted';
        }
        if (!exists) {
            return 'created';
        }
        return 'modified';
    }
    /**
     * Checks if file exists
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Updates symbol cache after AST recalculation
     */
    async updateSymbolCache(filePath, astDelta) {
        const currentSymbols = this.fileToSymbols.get(filePath) ?? new Set();
        // Remove deleted symbols
        for (const removed of astDelta.removedSymbols) {
            for (const symbol of currentSymbols) {
                if (symbol.name === removed.symbolName) {
                    currentSymbols.delete(symbol);
                }
            }
        }
        // Add new symbols
        for (const added of astDelta.addedSymbols) {
            currentSymbols.add({
                name: added.symbolName,
                signature: added.newSignature ?? '',
                nodeType: added.nodeType ?? 'Unknown',
                isExported: added.isExported,
                filePath,
            });
        }
        // Update modified symbols
        for (const modified of astDelta.modifiedSymbols) {
            for (const symbol of currentSymbols) {
                if (symbol.name === modified.symbolName) {
                    currentSymbols.delete(symbol);
                    currentSymbols.add({
                        ...symbol,
                        signature: modified.newSignature ?? symbol.signature,
                    });
                }
            }
        }
        // Update cache
        if (currentSymbols.size > 0) {
            this.fileToSymbols.set(filePath, currentSymbols);
        }
        else {
            this.fileToSymbols.delete(filePath);
        }
        // Enforce cache size limit
        this.enforceCacheSizeLimit();
    }
    /**
     * Enforces symbol cache size limit (LRU eviction)
     */
    enforceCacheSizeLimit() {
        if (this.fileToSymbols.size <= this.config.maxSymbolCacheSize) {
            return;
        }
        // Simple LRU: delete oldest entries
        const toDelete = this.fileToSymbols.size - this.config.maxSymbolCacheSize;
        let deleted = 0;
        for (const filePath of this.fileToSymbols.keys()) {
            if (deleted >= toDelete) {
                break;
            }
            // Only delete if no agents are using this file
            if (!this.fileToAgents.has(filePath)) {
                this.fileToSymbols.delete(filePath);
                deleted++;
            }
        }
    }
    /**
     * Initializes symbol cache from existing index
     */
    async initializeSymbolCache() {
        this.log('Initializing symbol cache...');
        try {
            const allFiles = await this.merkleDAG.getAllFiles();
            let cached = 0;
            for (const file of allFiles) {
                if (this.shouldIgnoreFile(file.path)) {
                    continue;
                }
                try {
                    const symbols = await this.extractSymbols(file.path);
                    this.fileToSymbols.set(file.path, new Set(symbols));
                    cached++;
                }
                catch (error) {
                    // Skip files that fail to parse
                }
            }
            this.log(`Symbol cache initialized with ${cached} files`);
        }
        catch (error) {
            this.log(`Warning: Failed to initialize symbol cache: ${this.getErrorMessage(error)}`);
        }
    }
    /* ===========================
     * Utilities
     * =========================== */
    /**
     * Normalizes file path
     */
    normalizePath(filePath) {
        return resolve(filePath);
    }
    /**
     * Validates workspace root exists
     */
    async validateWorkspaceRoot() {
        try {
            const stats = await fs.stat(this.config.workspaceRoot);
            if (!stats.isDirectory()) {
                throw new Error('Workspace root is not a directory');
            }
        }
        catch (error) {
            throw new Error(`Invalid workspace root: ${this.getErrorMessage(error)}`);
        }
    }
    /**
     * Ensures observer is started
     */
    ensureStarted() {
        if (!this.isStarted) {
            throw new Error('SwarmDeltaObserver not started. Call start() first.');
        }
        if (this.isShuttingDown) {
            throw new Error('SwarmDeltaObserver is shutting down');
        }
    }
    /**
     * Updates statistics
     */
    updateStats(processingTimeMs) {
        this.stats.totalMutations++;
        this.stats.totalDeltas++;
        // Update rolling average
        const prevAvg = this.stats.avgProcessingTimeMs;
        const count = this.stats.totalDeltas;
        this.stats.avgProcessingTimeMs =
            (prevAvg * (count - 1) + processingTimeMs) / count;
    }
    /**
     * Sets up error handlers
     */
    setupErrorHandlers() {
        this.on('error', (error) => {
            this.log(`Unhandled error: ${this.getErrorMessage(error)}`);
        });
    }
    /**
     * Logs message if logging enabled
     */
    log(message) {
        if (this.config.enableLogging) {
            console.log(`[SwarmDeltaObserver] ${message}`);
        }
    }
    /**
     * Safely extracts error message
     */
    getErrorMessage(error) {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        return 'Unknown error';
    }
}
/* ===========================
 * Factory & Exports
 * =========================== */
/**
 * Creates a new SwarmDeltaObserver instance
 *
 * @param merkleDAG - Merkle DAG instance
 * @param astGraph - AST Graph instance
 * @param config - Observer configuration
 * @returns SwarmDeltaObserver instance
 */
export function createSwarmDeltaObserver(merkleDAG, astGraph, config) {
    return new SwarmDeltaObserver(merkleDAG, astGraph, config);
}
/**
 * Type guard for checking if object is a FileMutationEvent
 */
export function isFileMutationEvent(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        'filePath' in obj &&
        'mutationType' in obj &&
        'timestamp' in obj);
}
/**
 * Default export
 */
export default SwarmDeltaObserver;
