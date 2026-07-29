// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/orchestrator/dag_swarm_bridge.ts

import { DAGNode, DAGDiffResult, MerkleDAGEngine } from '../dag/merkle_engine.js';
import { ContextPruner } from '../pipeline/context_pruner.js';
import { ASTDependencyGraph } from '../ast/dependency_graph.js';

/**
 * Agent execution payload for swarm dispatch
 */
export interface AgentExecutionPayload {
  taskId: string;
  timestamp: number;
  changeType: 'added' | 'modified' | 'deleted';
  targetFiles: Array<{
    path: string;
    content: string;
    hash: string;
    metadata?: Record<string, unknown>;
  }>;
  context: Map<string, string>;
  patchContext?: string;
  tokenEstimate: number;
}

/**
 * Swarm dispatch event
 */
export interface SwarmDispatchEvent {
  eventId: string;
  timestamp: number;
  payloads: AgentExecutionPayload[];
  diffSummary: {
    addedCount: number;
    modifiedCount: number;
    deletedCount: number;
    unchangedCount: number;
  };
  metrics: SwarmBenchmarkMetrics;
}

/**
 * Swarm benchmark telemetry metrics
 */
export interface SwarmBenchmarkMetrics {
  dispatchLatencyMs: number;
  contextPruningMs: number;
  payloadGenerationMs: number;
  totalTokens: number;
  payloadCount: number;
  averageContextSize: number;
  pruningRatio: number;
}

/**
 * Bridge configuration options
 */
export interface BridgeConfig {
  maxContextDepth?: number;
  maxTokensPerPayload?: number;
  enableSmartPruning?: boolean;
  batchDispatch?: boolean;
  telemetryEnabled?: boolean;
}

/**
 * Event listener callback type
 */
type DispatchListener = (event: SwarmDispatchEvent) => void | Promise<void>;

/**
 * DAG-to-Swarm Bridge for AI Agent Orchestration
 * Converts Merkle DAG state diffs into agent execution payloads
 */
export class DAGSwarmBridge {
  private merkleEngine: MerkleDAGEngine;
  private contextPruner: ContextPruner;
  private listeners: Set<DispatchListener>;
  private config: Required<BridgeConfig>;
  private taskCounter: number = 0;
  private eventCounter: number = 0;
  private telemetryBuffer: SwarmBenchmarkMetrics[] = [];
  private readonly maxTelemetryBuffer: number = 1000;

  constructor(
    merkleEngine?: MerkleDAGEngine,
    contextPruner?: ContextPruner,
    config: BridgeConfig = {}
  ) {
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
  public async dispatchDiff(
    oldRoot: DAGNode,
    newRoot: DAGNode
  ): Promise<SwarmDispatchEvent> {
    const startTime = performance.now();

    // Compute DAG diff
    const diffResult = this.merkleEngine.computeDiff(oldRoot, newRoot);

    // Generate agent payloads
    const payloadStartTime = performance.now();
    const payloads = await this.generateAgentPayloads(diffResult, newRoot);
    const payloadGenerationMs = performance.now() - payloadStartTime;

    // Build dispatch event
    const event: SwarmDispatchEvent = {
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
  private async generateAgentPayloads(
    diffResult: DAGDiffResult,
    newRoot: DAGNode
  ): Promise<AgentExecutionPayload[]> {
    const payloads: AgentExecutionPayload[] = [];

    // Process added files
    for (const addedNode of diffResult.added) {
      if (addedNode.content !== null) {
        const payload = await this.createPayload(
          addedNode,
          'added',
          newRoot
        );
        payloads.push(payload);
      }
    }

    // Process modified files
    for (const modified of diffResult.modified) {
      if (modified.newNode.content !== null) {
        const payload = await this.createPayload(
          modified.newNode,
          'modified',
          newRoot,
          modified.patchContext
        );
        payloads.push(payload);
      }
    }

    // Process deleted files (minimal payload)
    for (const deletedNode of diffResult.deleted) {
      if (deletedNode.content !== null) {
        const payload: AgentExecutionPayload = {
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
  private async createPayload(
    targetNode: DAGNode,
    changeType: 'added' | 'modified',
    dagRoot: DAGNode,
    patchContext?: string
  ): Promise<AgentExecutionPayload> {
    const startTime = performance.now();

    let context = new Map<string, string>();
    let tokenEstimate = 0;

    if (this.config.enableSmartPruning) {
      try {
        const prunedContext = await this.contextPruner.extractPrunedContext(
          targetNode.path,
          dagRoot,
          this.config.maxContextDepth
        );
        context = prunedContext.prunedFiles;
        tokenEstimate = prunedContext.tokenEstimate;
      } catch (error) {
        // Fallback to single file context
        if (targetNode.content !== null) {
          context.set(targetNode.path, targetNode.content);
          tokenEstimate = this.estimateTokens(targetNode.content);
        }
      }
    } else {
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

    const payload: AgentExecutionPayload = {
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
  private optimizePayloads(payloads: AgentExecutionPayload[]): AgentExecutionPayload[] {
    // Group payloads by directory
    const grouped = new Map<string, AgentExecutionPayload[]>();

    for (const payload of payloads) {
      const dir = this.getDirectory(payload.targetFiles[0].path);
      if (!grouped.has(dir)) {
        grouped.set(dir, []);
      }
      grouped.get(dir)!.push(payload);
    }

    const optimized: AgentExecutionPayload[] = [];

    for (const [dir, dirPayloads] of grouped.entries()) {
      if (dirPayloads.length === 1) {
        optimized.push(dirPayloads[0]);
        continue;
      }

      // Try to merge payloads in the same directory
      let mergedContext = new Map<string, string>();
      let mergedTokens = 0;
      const mergedFiles: AgentExecutionPayload['targetFiles'] = [];

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
      } else {
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
  private truncateContext(
    context: Map<string, string>,
    maxTokens: number
  ): Map<string, string> {
    const truncated = new Map<string, string>();
    let currentTokens = 0;

    // Prioritize files - target file first, then dependencies
    const sortedEntries = Array.from(context.entries());

    for (const [path, content] of sortedEntries) {
      const tokens = this.estimateTokens(content);
      
      if (currentTokens + tokens <= maxTokens) {
        truncated.set(path, content);
        currentTokens += tokens;
      } else {
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
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /**
   * Gets directory from file path
   */
  private getDirectory(path: string): string {
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return lastSlash > 0 ? path.slice(0, lastSlash) : '';
  }

  /**
   * Generates unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${this.taskCounter++}`;
  }

  /**
   * Generates unique event ID
   */
  private generateEventId(): string {
    return `event_${Date.now()}_${this.eventCounter++}`;
  }

  /**
   * Records telemetry metrics
   */
  private recordTelemetry(metrics: SwarmBenchmarkMetrics): void {
    this.telemetryBuffer.push(metrics);

    // Maintain buffer size
    if (this.telemetryBuffer.length > this.maxTelemetryBuffer) {
      this.telemetryBuffer.shift();
    }
  }

  /**
   * Notifies all registered listeners
   */
  private async notifyListeners(event: SwarmDispatchEvent): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const listener of this.listeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (error) {
        // Listener errors should not break dispatch
        console.error('Listener error:', error);
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * Registers event listener for swarm dispatches
   */
  public onDispatch(listener: DispatchListener): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Removes all event listeners
   */
  public clearListeners(): void {
    this.listeners.clear();
  }

  /**
   * Gets aggregated telemetry metrics
   */
  public getTelemetryStats(): {
    avgDispatchLatency: number;
    avgContextPruning: number;
    avgPayloadGeneration: number;
    avgTokensPerEvent: number;
    avgPayloadsPerEvent: number;
    totalEvents: number;
  } {
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

    const sum = this.telemetryBuffer.reduce(
      (acc, m) => ({
        dispatchLatencyMs: acc.dispatchLatencyMs + m.dispatchLatencyMs,
        contextPruningMs: acc.contextPruningMs + m.contextPruningMs,
        payloadGenerationMs: acc.payloadGenerationMs + m.payloadGenerationMs,
        totalTokens: acc.totalTokens + m.totalTokens,
        payloadCount: acc.payloadCount + m.payloadCount
      }),
      {
        dispatchLatencyMs: 0,
        contextPruningMs: 0,
        payloadGenerationMs: 0,
        totalTokens: 0,
        payloadCount: 0
      }
    );

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
  public dispatchDiffSync(oldRoot: DAGNode, newRoot: DAGNode): SwarmDispatchEvent {
    const startTime = performance.now();

    const diffResult = this.merkleEngine.computeDiff(oldRoot, newRoot);

    // Simplified synchronous payload generation
    const payloads: AgentExecutionPayload[] = [];

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

    const event: SwarmDispatchEvent = {
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
      } catch (error) {
        console.error('Listener error:', error);
      }
    }

    return event;
  }

  /**
   * Updates bridge configuration
   */
  public updateConfig(config: Partial<BridgeConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
  }

  /**
   * Gets current configuration
   */
  public getConfig(): Required<BridgeConfig> {
    return { ...this.config };
  }

  /**
   * Resets telemetry buffer
   */
  public resetTelemetry(): void {
    this.telemetryBuffer = [];
  }

  /**
   * Gets raw telemetry buffer
   */
  public getRawTelemetry(): SwarmBenchmarkMetrics[] {
    return [...this.telemetryBuffer];
  }
}
