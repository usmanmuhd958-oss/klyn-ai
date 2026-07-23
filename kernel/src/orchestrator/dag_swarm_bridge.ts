import { DAGNode, StateDiffResult, MerkleDAGEngine } from '../dag/merkle_engine';
import { SwarmBenchmark, MetricSnapshot } from './swarm_benchmark';

export interface AgentContextPayload {
  agentId: string;
  diffSummary: StateDiffResult;
  tokenUsageEstimate: number;
  payloadContext: string[];
  timestamp: number;
  processingTimeMs?: number;
  memorySnapshotMB?: number;
}

export interface ProcessedContext {
  prunedFiles: string[];
  totalTokens: number;
  withinBudget: boolean;
}

export class DAGSwarmBridge {
  private dagEngine: MerkleDAGEngine;
  private benchmark?: SwarmBenchmark;

  constructor(dagEngine: MerkleDAGEngine, benchmark?: SwarmBenchmark) {
    this.dagEngine = dagEngine;
    this.benchmark = benchmark;
  }

  private extractPath(item: string | { path: string }): string {
    return typeof item === 'string' ? item : item.path;
  }

  public async dispatchStateChange(
    oldRoot: DAGNode | null,
    newRoot: DAGNode,
    agentId: string
  ): Promise<AgentContextPayload> {
    const sessionId = `dispatch-${Date.now()}`;
    if (this.benchmark) {
      this.benchmark.startSession(sessionId, agentId);
    }

    const diff = this.dagEngine.computeDiff(oldRoot, newRoot);
    const rawFiles = [...diff.modified, ...diff.added];
    const contextFiles: string[] = rawFiles.map(file => this.extractPath(file));
    const estimatedTokens = contextFiles.reduce((acc, filePath) => acc + filePath.length * 4, 0);

    let metric: MetricSnapshot | undefined;
    if (this.benchmark) {
      metric = this.benchmark.endSession(sessionId, estimatedTokens, false);
    }

    return {
      agentId,
      diffSummary: diff,
      tokenUsageEstimate: estimatedTokens,
      payloadContext: contextFiles,
      timestamp: Date.now(),
      processingTimeMs: metric ? metric.durationMs : 0,
      memorySnapshotMB: metric ? metric.heapUsedMB : 0,
    };
  }

  public pruneContextByBudget(diff: StateDiffResult, maxTokens: number): ProcessedContext {
    const sessionId = `prune-${Date.now()}`;
    if (this.benchmark) {
      this.benchmark.startSession(sessionId, 'bridge-pruner');
    }

    const rawFiles = [...diff.modified, ...diff.added];
    const allFiles: string[] = rawFiles.map(file => this.extractPath(file));
    const prunedFiles: string[] = [];
    let currentTokens = 0;

    for (const filePath of allFiles) {
      const fileTokenCost = Math.ceil(filePath.length * 1.5);
      if (currentTokens + fileTokenCost <= maxTokens) {
        prunedFiles.push(filePath);
        currentTokens += fileTokenCost;
      } else {
        break;
      }
    }

    if (this.benchmark) {
      this.benchmark.endSession(sessionId, currentTokens, false);
    }

    return {
      prunedFiles,
      totalTokens: currentTokens,
      withinBudget: currentTokens <= maxTokens,
    };
  }

  public getSnapshot(): object {
    return this.benchmark ? this.benchmark.getSnapshot() : {};
  }

  public printReport(): void {
    if (this.benchmark) {
      this.benchmark.printReport();
    }
  }
}
