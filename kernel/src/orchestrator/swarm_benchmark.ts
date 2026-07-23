/**
 * @fileoverview SwarmBenchmark - Real-time performance benchmarking system
 * @module kernel/orchestrator/swarm_benchmark
 * 
 * Provides comprehensive performance monitoring for Swarm Agent execution,
 * memory footprint tracking, Merkle AST context extraction latency measurement,
 * and parallel worker throughput analysis.
 * 
 * @author Klyn AI OS Core Team
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { performance, PerformanceObserver, PerformanceEntry } from 'perf_hooks';
import { memoryUsage, cpuUsage, hrtime } from 'process';

/* ===========================
 * Type Definitions
 * =========================== */

/**
 * Benchmark metric categories
 */
export type BenchmarkCategory = 
  | 'agent_execution'
  | 'context_extraction'
  | 'merkle_dag'
  | 'ast_graph'
  | 'search'
  | 'memory'
  | 'throughput'
  | 'latency'
  | 'cache';

/**
 * Performance metric data point
 */
export interface PerformanceMetric {
  /** Metric category */
  readonly category: BenchmarkCategory;
  
  /** Metric name */
  readonly name: string;
  
  /** Metric value */
  readonly value: number;
  
  /** Unit of measurement */
  readonly unit: 'ms' | 'MB' | 'ops/sec' | 'count' | 'percent' | 'bytes';
  
  /** Timestamp */
  readonly timestamp: number;
  
  /** Additional tags for filtering */
  readonly tags?: Readonly<Record<string, string>>;
}

/**
 * Agent execution benchmark data
 */
export interface AgentExecutionBenchmark {
  /** Agent ID */
  readonly agentId: string;
  
  /** Agent role */
  readonly role: string;
  
  /** Task ID */
  readonly taskId: string;
  
  /** Total execution time (ms) */
  readonly executionTimeMs: number;
  
  /** Context preparation time (ms) */
  readonly contextPrepTimeMs: number;
  
  /** LLM inference time (ms) */
  readonly llmInferenceTimeMs: number;
  
  /** File write time (ms) */
  readonly fileWriteTimeMs: number;
  
  /** Tokens processed */
  readonly tokensProcessed: number;
  
  /** Tokens per second */
  readonly tokensPerSecond: number;
  
  /** Memory delta (MB) */
  readonly memoryDeltaMB: number;
  
  /** CPU usage percent */
  readonly cpuUsagePercent: number;
  
  /** Success status */
  readonly success: boolean;
}

/**
 * Context extraction benchmark data
 */
export interface ContextExtractionBenchmark {
  /** Task descriptor hash */
  readonly descriptorHash: string;
  
  /** Agent role */
  readonly role: string;
  
  /** Total extraction time (ms) */
  readonly totalTimeMs: number;
  
  /** File read time (ms) */
  readonly fileReadTimeMs: number;
  
  /** AST parsing time (ms) */
  readonly astParsingTimeMs: number;
  
  /** Symbol resolution time (ms) */
  readonly symbolResolutionTimeMs: number;
  
  /** Dependency traversal time (ms) */
  readonly dependencyTraversalTimeMs: number;
  
  /** Token budgeting time (ms) */
  readonly tokenBudgetingTimeMs: number;
  
  /** Files processed */
  readonly filesProcessed: number;
  
  /** Symbols extracted */
  readonly symbolsExtracted: number;
  
  /** Dependencies resolved */
  readonly dependenciesResolved: number;
  
  /** Final token count */
  readonly finalTokenCount: number;
  
  /** Cache hit */
  readonly cacheHit: boolean;
}

/**
 * Merkle DAG operation benchmark
 */
export interface MerkleDAGBenchmark {
  /** Operation type */
  readonly operation: 'hash' | 'update' | 'diff' | 'traverse' | 'verify';
  
  /** File path */
  readonly filePath: string;
  
  /** Operation duration (ms) */
  readonly durationMs: number;
  
  /** Node count processed */
  readonly nodesProcessed: number;
  
  /** Hash calculations */
  readonly hashCalculations: number;
  
  /** Memory used (MB) */
  readonly memoryUsedMB: number;
}

/**
 * AST Graph operation benchmark
 */
export interface ASTGraphBenchmark {
  /** Operation type */
  readonly operation: 'parse' | 'query' | 'traverse' | 'update' | 'search';
  
  /** File path */
  readonly filePath?: string;
  
  /** Operation duration (ms) */
  readonly durationMs: number;
  
  /** Nodes processed */
  readonly nodesProcessed: number;
  
  /** Edges traversed */
  readonly edgesTraversed: number;
  
  /** Symbols resolved */
  readonly symbolsResolved: number;
  
  /** Cache hit */
  readonly cacheHit: boolean;
}

/**
 * Search operation benchmark
 */
export interface SearchBenchmark {
  /** Search query */
  readonly query: string;
  
  /** Search type */
  readonly searchType: 'semantic' | 'symbolic' | 'hybrid';
  
  /** Total duration (ms) */
  readonly totalDurationMs: number;
  
  /** Index lookup time (ms) */
  readonly indexLookupMs: number;
  
  /** Ranking time (ms) */
  readonly rankingMs: number;
  
  /** Results count */
  readonly resultsCount: number;
  
  /** Files searched */
  readonly filesSearched: number;
  
  /** Cache hit */
  readonly cacheHit: boolean;
}

/**
 * Memory snapshot
 */
export interface MemorySnapshot {
  /** Timestamp */
  readonly timestamp: number;
  
  /** Heap used (MB) */
  readonly heapUsedMB: number;
  
  /** Heap total (MB) */
  readonly heapTotalMB: number;
  
  /** RSS (MB) */
  readonly rssMB: number;
  
  /** External memory (MB) */
  readonly externalMB: number;
  
  /** Array buffers (MB) */
  readonly arrayBuffersMB: number;
}

/**
 * Throughput metrics
 */
export interface ThroughputMetrics {
  /** Measurement window (ms) */
  readonly windowMs: number;
  
  /** Tasks completed */
  readonly tasksCompleted: number;
  
  /** Tasks per second */
  readonly tasksPerSecond: number;
  
  /** Tokens processed */
  readonly tokensProcessed: number;
  
  /** Tokens per second */
  readonly tokensPerSecond: number;
  
  /** Files mutated */
  readonly filesMutated: number;
  
  /** Files per second */
  readonly filesPerSecond: number;
  
  /** Average task latency (ms) */
  readonly avgTaskLatencyMs: number;
  
  /** P95 task latency (ms) */
  readonly p95TaskLatencyMs: number;
  
  /** P99 task latency (ms) */
  readonly p99TaskLatencyMs: number;
}

/**
 * Cache performance metrics
 */
export interface CacheMetrics {
  /** Cache name */
  readonly cacheName: string;
  
  /** Total requests */
  readonly totalRequests: number;
  
  /** Cache hits */
  readonly hits: number;
  
  /** Cache misses */
  readonly misses: number;
  
  /** Hit rate (percent) */
  readonly hitRate: number;
  
  /** Average hit latency (ms) */
  readonly avgHitLatencyMs: number;
  
  /** Average miss latency (ms) */
  readonly avgMissLatencyMs: number;
  
  /** Cache size (entries) */
  readonly cacheSize: number;
  
  /** Memory usage (MB) */
  readonly memoryUsageMB: number;
}

/**
 * Comprehensive benchmark report
 */
export interface BenchmarkReport {
  /** Report generation timestamp */
  readonly timestamp: number;
  
  /** Reporting period (ms) */
  readonly periodMs: number;
  
  /** Agent execution benchmarks */
  readonly agentExecutions: ReadonlyArray<AgentExecutionBenchmark>;
  
  /** Context extraction benchmarks */
  readonly contextExtractions: ReadonlyArray<ContextExtractionBenchmark>;
  
  /** Merkle DAG benchmarks */
  readonly merkleDAGOps: ReadonlyArray<MerkleDAGBenchmark>;
  
  /** AST Graph benchmarks */
  readonly astGraphOps: ReadonlyArray<ASTGraphBenchmark>;
  
  /** Search benchmarks */
  readonly searchOps: ReadonlyArray<SearchBenchmark>;
  
  /** Memory snapshots */
  readonly memorySnapshots: ReadonlyArray<MemorySnapshot>;
  
  /** Throughput metrics */
  readonly throughput: ThroughputMetrics;
  
  /** Cache metrics */
  readonly cacheMetrics: ReadonlyArray<CacheMetrics>;
  
  /** Summary statistics */
  readonly summary: Readonly<{
    totalAgentExecutions: number;
    avgAgentExecutionTimeMs: number;
    totalContextExtractions: number;
    avgContextExtractionTimeMs: number;
    totalMerkleDAGOps: number;
    avgMerkleDAGOpTimeMs: number;
    totalASTGraphOps: number;
    avgASTGraphOpTimeMs: number;
    totalSearchOps: number;
    avgSearchOpTimeMs: number;
    avgMemoryUsageMB: number;
    peakMemoryUsageMB: number;
    overallCacheHitRate: number;
  }>;
}

/**
 * Benchmark configuration
 */
export interface SwarmBenchmarkConfig {
  /** Enable agent execution benchmarking */
  readonly enableAgentBenchmarks?: boolean;
  
  /** Enable context extraction benchmarking */
  readonly enableContextBenchmarks?: boolean;
  
  /** Enable Merkle DAG benchmarking */
  readonly enableMerkleDAGBenchmarks?: boolean;
  
  /** Enable AST Graph benchmarking */
  readonly enableASTGraphBenchmarks?: boolean;
  
  /** Enable search benchmarking */
  readonly enableSearchBenchmarks?: boolean;
  
  /** Enable memory tracking */
  readonly enableMemoryTracking?: boolean;
  
  /** Enable throughput tracking */
  readonly enableThroughputTracking?: boolean;
  
  /** Enable cache metrics */
  readonly enableCacheMetrics?: boolean;
  
  /** Memory snapshot interval (ms) */
  readonly memorySnapshotIntervalMs?: number;
  
  /** Throughput window (ms) */
  readonly throughputWindowMs?: number;
  
  /** Maximum metrics retention count */
  readonly maxMetricsRetention?: number;
  
  /** Enable high-resolution timing */
  readonly enableHighResolutionTiming?: boolean;
  
  /** Enable performance observer */
  readonly enablePerformanceObserver?: boolean;
}

/**
 * Benchmark timing context
 */
interface TimingContext {
  startTime: number;
  startMemory: NodeJS.MemoryUsage;
  startCPU: NodeJS.CpuUsage;
  metadata: Record<string, unknown>;
}

/**
 * Latency histogram bucket
 */
interface LatencyBucket {
  min: number;
  max: number;
  count: number;
}

/* ===========================
 * SwarmBenchmark Implementation
 * =========================== */

/**
 * SwarmBenchmark - Comprehensive performance benchmarking system
 * 
 * Tracks and analyzes performance metrics across all Swarm Engine components
 * with real-time telemetry emission and historical analysis capabilities.
 * 
 * @example
 * ```typescript
 * const benchmark = new SwarmBenchmark({
 *   enableAgentBenchmarks: true,
 *   enableMemoryTracking: true
 * });
 * 
 * benchmark.on('metric', (metric) => {
 *   console.log(`${metric.name}: ${metric.value}${metric.unit}`);
 * });
 * 
 * benchmark.start();
 * 
 * // Benchmark agent execution
 * const timingId = benchmark.startAgentExecution('agent-1', 'CODER', 'task-1');
 * // ... agent work ...
 * benchmark.endAgentExecution(timingId, { success: true, tokensProcessed: 1500 });
 * 
 * const report = benchmark.generateReport();
 * ```
 */
export class SwarmBenchmark extends EventEmitter {
  private readonly config: Required<SwarmBenchmarkConfig>;
  
  // Benchmark data stores
  private readonly agentExecutions: AgentExecutionBenchmark[];
  private readonly contextExtractions: ContextExtractionBenchmark[];
  private readonly merkleDAGOps: MerkleDAGBenchmark[];
  private readonly astGraphOps: ASTGraphBenchmark[];
  private readonly searchOps: SearchBenchmark[];
  private readonly memorySnapshots: MemorySnapshot[];
  private readonly metrics: PerformanceMetric[];
  
  // Active timing contexts
  private readonly activeTimings: Map<string, TimingContext>;
  
  // Throughput tracking
  private throughputWindowStart: number;
  private throughputTasksCompleted: number;
  private throughputTokensProcessed: number;
  private throughputFilesMutated: number;
  private readonly taskLatencies: number[];
  
  // Cache tracking
  private readonly cacheStats: Map<string, {
    hits: number;
    misses: number;
    hitLatencies: number[];
    missLatencies: number[];
  }>;
  
  // Timers
  private memorySnapshotTimer: NodeJS.Timeout | null;
  private performanceObserver: PerformanceObserver | null;
  
  // State
  private isRunning: boolean;
  private readonly startTime: number;

  /**
   * Creates a new SwarmBenchmark instance
   */
  constructor(config: SwarmBenchmarkConfig = {}) {
    super();
    
    this.config = {
      enableAgentBenchmarks: config.enableAgentBenchmarks ?? true,
      enableContextBenchmarks: config.enableContextBenchmarks ?? true,
      enableMerkleDAGBenchmarks: config.enableMerkleDAGBenchmarks ?? true,
      enableASTGraphBenchmarks: config.enableASTGraphBenchmarks ?? true,
      enableSearchBenchmarks: config.enableSearchBenchmarks ?? true,
      enableMemoryTracking: config.enableMemoryTracking ?? true,
      enableThroughputTracking: config.enableThroughputTracking ?? true,
      enableCacheMetrics: config.enableCacheMetrics ?? true,
      memorySnapshotIntervalMs: config.memorySnapshotIntervalMs ?? 1000,
      throughputWindowMs: config.throughputWindowMs ?? 10000,
      maxMetricsRetention: config.maxMetricsRetention ?? 10000,
      enableHighResolutionTiming: config.enableHighResolutionTiming ?? true,
      enablePerformanceObserver: config.enablePerformanceObserver ?? false,
    };
    
    this.agentExecutions = [];
    this.contextExtractions = [];
    this.merkleDAGOps = [];
    this.astGraphOps = [];
    this.searchOps = [];
    this.memorySnapshots = [];
    this.metrics = [];
    
    this.activeTimings = new Map();
    
    this.throughputWindowStart = Date.now();
    this.throughputTasksCompleted = 0;
    this.throughputTokensProcessed = 0;
    this.throughputFilesMutated = 0;
    this.taskLatencies = [];
    
    this.cacheStats = new Map();
    
    this.memorySnapshotTimer = null;
    this.performanceObserver = null;
    
    this.isRunning = false;
    this.startTime = Date.now();
  }

  /* ===========================
   * Lifecycle Methods
   * =========================== */

  /**
   * Starts the benchmark system
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    
    // Start memory tracking
    if (this.config.enableMemoryTracking) {
      this.startMemoryTracking();
    }
    
    // Start performance observer
    if (this.config.enablePerformanceObserver) {
      this.startPerformanceObserver();
    }
    
    this.emit('benchmark:started');
  }

  /**
   * Stops the benchmark system
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    // Stop memory tracking
    if (this.memorySnapshotTimer) {
      clearInterval(this.memorySnapshotTimer);
      this.memorySnapshotTimer = null;
    }
    
    // Stop performance observer
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }
    
    this.emit('benchmark:stopped');
  }

  /**
   * Resets all benchmark data
   */
  public reset(): void {
    this.agentExecutions.length = 0;
    this.contextExtractions.length = 0;
    this.merkleDAGOps.length = 0;
    this.astGraphOps.length = 0;
    this.searchOps.length = 0;
    this.memorySnapshots.length = 0;
    this.metrics.length = 0;
    this.activeTimings.clear();
    this.taskLatencies.length = 0;
    this.cacheStats.clear();
    
    this.throughputWindowStart = Date.now();
    this.throughputTasksCompleted = 0;
    this.throughputTokensProcessed = 0;
    this.throughputFilesMutated = 0;
    
    this.emit('benchmark:reset');
  }

  /* ===========================
   * Agent Execution Benchmarking
   * =========================== */

  /**
   * Starts timing an agent execution
   * 
   * @param agentId - Agent identifier
   * @param role - Agent role
   * @param taskId - Task identifier
   * @returns Timing ID for ending the benchmark
   */
  public startAgentExecution(
    agentId: string,
    role: string,
    taskId: string
  ): string {
    if (!this.config.enableAgentBenchmarks) {
      return '';
    }
    
    const timingId = `agent-${agentId}-${Date.now()}`;
    
    this.activeTimings.set(timingId, {
      startTime: this.getHighResolutionTime(),
      startMemory: memoryUsage(),
      startCPU: cpuUsage(),
      metadata: { agentId, role, taskId },
    });
    
    return timingId;
  }

  /**
   * Ends timing an agent execution
   * 
   * @param timingId - Timing ID from startAgentExecution
   * @param result - Execution result metadata
   */
  public endAgentExecution(
    timingId: string,
    result: {
      success: boolean;
      tokensProcessed: number;
      contextPrepTimeMs?: number;
      llmInferenceTimeMs?: number;
      fileWriteTimeMs?: number;
    }
  ): void {
    if (!this.config.enableAgentBenchmarks || !timingId) {
      return;
    }
    
    const context = this.activeTimings.get(timingId);
    if (!context) {
      return;
    }
    
    const endTime = this.getHighResolutionTime();
    const endMemory = memoryUsage();
    const endCPU = cpuUsage(context.startCPU);
    
    const executionTimeMs = endTime - context.startTime;
    const memoryDeltaMB = (endMemory.heapUsed - context.startMemory.heapUsed) / 1024 / 1024;
    const cpuUsagePercent = ((endCPU.user + endCPU.system) / 1000000) / executionTimeMs * 100;
    const tokensPerSecond = result.tokensProcessed / (executionTimeMs / 1000);
    
    const benchmark: AgentExecutionBenchmark = {
      agentId: context.metadata.agentId as string,
      role: context.metadata.role as string,
      taskId: context.metadata.taskId as string,
      executionTimeMs,
      contextPrepTimeMs: result.contextPrepTimeMs ?? 0,
      llmInferenceTimeMs: result.llmInferenceTimeMs ?? 0,
      fileWriteTimeMs: result.fileWriteTimeMs ?? 0,
      tokensProcessed: result.tokensProcessed,
      tokensPerSecond,
      memoryDeltaMB,
      cpuUsagePercent,
      success: result.success,
    };
    
    this.agentExecutions.push(benchmark);
    this.enforceRetentionLimit(this.agentExecutions);
    
    // Update throughput metrics
    if (result.success && this.config.enableThroughputTracking) {
      this.throughputTasksCompleted++;
      this.throughputTokensProcessed += result.tokensProcessed;
      this.taskLatencies.push(executionTimeMs);
    }
    
    // Emit metrics
    this.emitMetric({
      category: 'agent_execution',
      name: 'execution_time',
      value: executionTimeMs,
      unit: 'ms',
      timestamp: Date.now(),
      tags: { agentId: benchmark.agentId, role: benchmark.role },
    });
    
    this.emitMetric({
      category: 'agent_execution',
      name: 'tokens_per_second',
      value: tokensPerSecond,
      unit: 'ops/sec',
      timestamp: Date.now(),
      tags: { agentId: benchmark.agentId, role: benchmark.role },
    });
    
    this.activeTimings.delete(timingId);
    
    this.emit('benchmark:agent-execution', benchmark);
  }

  /* ===========================
   * Context Extraction Benchmarking
   * =========================== */

  /**
   * Starts timing a context extraction
   * 
   * @param descriptorHash - Hash of task descriptor
   * @param role - Agent role
   * @returns Timing ID
   */
  public startContextExtraction(
    descriptorHash: string,
    role: string
  ): string {
    if (!this.config.enableContextBenchmarks) {
      return '';
    }
    
    const timingId = `context-${descriptorHash}-${Date.now()}`;
    
    this.activeTimings.set(timingId, {
      startTime: this.getHighResolutionTime(),
      startMemory: memoryUsage(),
      startCPU: cpuUsage(),
      metadata: { descriptorHash, role },
    });
    
    return timingId;
  }

  /**
   * Records context extraction phase timing
   * 
   * @param timingId - Timing ID
   * @param phase - Extraction phase name
   * @param durationMs - Phase duration
   */
  public recordContextExtractionPhase(
    timingId: string,
    phase: 'file_read' | 'ast_parsing' | 'symbol_resolution' | 'dependency_traversal' | 'token_budgeting',
    durationMs: number
  ): void {
    if (!this.config.enableContextBenchmarks || !timingId) {
      return;
    }
    
    const context = this.activeTimings.get(timingId);
    if (!context) {
      return;
    }
    
    context.metadata[`${phase}_time`] = durationMs;
  }

  /**
   * Ends timing a context extraction
   * 
   * @param timingId - Timing ID from startContextExtraction
   * @param result - Extraction result metadata
   */
  public endContextExtraction(
    timingId: string,
    result: {
      filesProcessed: number;
      symbolsExtracted: number;
      dependenciesResolved: number;
      finalTokenCount: number;
      cacheHit: boolean;
    }
  ): void {
    if (!this.config.enableContextBenchmarks || !timingId) {
      return;
    }
    
    const context = this.activeTimings.get(timingId);
    if (!context) {
      return;
    }
    
    const endTime = this.getHighResolutionTime();
    const totalTimeMs = endTime - context.startTime;
    
    const benchmark: ContextExtractionBenchmark = {
      descriptorHash: context.metadata.descriptorHash as string,
      role: context.metadata.role as string,
      totalTimeMs,
      fileReadTimeMs: (context.metadata.file_read_time as number) ?? 0,
      astParsingTimeMs: (context.metadata.ast_parsing_time as number) ?? 0,
      symbolResolutionTimeMs: (context.metadata.symbol_resolution_time as number) ?? 0,
      dependencyTraversalTimeMs: (context.metadata.dependency_traversal_time as number) ?? 0,
      tokenBudgetingTimeMs: (context.metadata.token_budgeting_time as number) ?? 0,
      filesProcessed: result.filesProcessed,
      symbolsExtracted: result.symbolsExtracted,
      dependenciesResolved: result.dependenciesResolved,
      finalTokenCount: result.finalTokenCount,
      cacheHit: result.cacheHit,
    };
    
    this.contextExtractions.push(benchmark);
    this.enforceRetentionLimit(this.contextExtractions);
    
    // Update cache stats
    if (this.config.enableCacheMetrics) {
      this.recordCacheAccess('context', result.cacheHit, totalTimeMs);
    }
    
    // Emit metrics
    this.emitMetric({
      category: 'context_extraction',
      name: 'total_time',
      value: totalTimeMs,
      unit: 'ms',
      timestamp: Date.now(),
      tags: { role: benchmark.role, cacheHit: result.cacheHit.toString() },
    });
    
    this.emitMetric({
      category: 'context_extraction',
      name: 'symbols_extracted',
      value: result.symbolsExtracted,
      unit: 'count',
      timestamp: Date.now(),
      tags: { role: benchmark.role },
    });
    
    this.activeTimings.delete(timingId);
    
    this.emit('benchmark:context-extraction', benchmark);
  }

  /* ===========================
   * Merkle DAG Benchmarking
   * =========================== */

  /**
   * Benchmarks a Merkle DAG operation
   * 
   * @param operation - Operation type
   * @param filePath - File path
   * @param fn - Function to benchmark
   * @returns Promise resolving to function result
   */
  public async benchmarkMerkleDAGOperation<T>(
    operation: 'hash' | 'update' | 'diff' | 'traverse' | 'verify',
    filePath: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enableMerkleDAGBenchmarks) {
      return fn();
    }
    
    const startTime = this.getHighResolutionTime();
    const startMemory = memoryUsage();
    
    let nodesProcessed = 0;
    let hashCalculations = 0;
    
    try {
      const result = await fn();
      
      // Extract metrics from result if available
      if (typeof result === 'object' && result !== null) {
        nodesProcessed = (result as { nodesProcessed?: number }).nodesProcessed ?? 1;
        hashCalculations = (result as { hashCalculations?: number }).hashCalculations ?? 1;
      } else {
        nodesProcessed = 1;
        hashCalculations = 1;
      }
      
      return result;
    } finally {
      const endTime = this.getHighResolutionTime();
      const endMemory = memoryUsage();
      
      const durationMs = endTime - startTime;
      const memoryUsedMB = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;
      
      const benchmark: MerkleDAGBenchmark = {
        operation,
        filePath,
        durationMs,
        nodesProcessed,
        hashCalculations,
        memoryUsedMB,
      };
      
      this.merkleDAGOps.push(benchmark);
      this.enforceRetentionLimit(this.merkleDAGOps);
      
      this.emitMetric({
        category: 'merkle_dag',
        name: `${operation}_time`,
        value: durationMs,
        unit: 'ms',
        timestamp: Date.now(),
        tags: { operation },
      });
      
      this.emit('benchmark:merkle-dag', benchmark);
    }
  }

  /* ===========================
   * AST Graph Benchmarking
   * =========================== */

  /**
   * Benchmarks an AST Graph operation
   * 
   * @param operation - Operation type
   * @param filePath - File path (optional)
   * @param fn - Function to benchmark
   * @returns Promise resolving to function result
   */
  public async benchmarkASTGraphOperation<T>(
    operation: 'parse' | 'query' | 'traverse' | 'update' | 'search',
    filePath: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enableASTGraphBenchmarks) {
      return fn();
    }
    
    const startTime = this.getHighResolutionTime();
    
    let nodesProcessed = 0;
    let edgesTraversed = 0;
    let symbolsResolved = 0;
    let cacheHit = false;
    
    try {
      const result = await fn();
      
      // Extract metrics from result if available
      if (typeof result === 'object' && result !== null) {
        nodesProcessed = (result as { nodesProcessed?: number }).nodesProcessed ?? 1;
        edgesTraversed = (result as { edgesTraversed?: number }).edgesTraversed ?? 0;
        symbolsResolved = (result as { symbolsResolved?: number }).symbolsResolved ?? 0;
        cacheHit = (result as { cacheHit?: boolean }).cacheHit ?? false;
      } else if (Array.isArray(result)) {
        nodesProcessed = result.length;
      } else {
        nodesProcessed = 1;
      }
      
      return result;
    } finally {
      const endTime = this.getHighResolutionTime();
      const durationMs = endTime - startTime;
      
      const benchmark: ASTGraphBenchmark = {
        operation,
        filePath,
        durationMs,
        nodesProcessed,
        edgesTraversed,
        symbolsResolved,
        cacheHit,
      };
      
      this.astGraphOps.push(benchmark);
      this.enforceRetentionLimit(this.astGraphOps);
      
      // Update cache stats
      if (this.config.enableCacheMetrics && cacheHit !== undefined) {
        this.recordCacheAccess('ast_graph', cacheHit, durationMs);
      }
      
      this.emitMetric({
        category: 'ast_graph',
        name: `${operation}_time`,
        value: durationMs,
        unit: 'ms',
        timestamp: Date.now(),
        tags: { operation, cacheHit: cacheHit.toString() },
      });
      
      this.emit('benchmark:ast-graph', benchmark);
    }
  }

  /* ===========================
   * Search Benchmarking
   * =========================== */

  /**
   * Benchmarks a search operation
   * 
   * @param query - Search query
   * @param searchType - Search type
   * @param fn - Function to benchmark
   * @returns Promise resolving to function result
   */
  public async benchmarkSearchOperation<T>(
    query: string,
    searchType: 'semantic' | 'symbolic' | 'hybrid',
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enableSearchBenchmarks) {
      return fn();
    }
    
    const startTime = this.getHighResolutionTime();
    
    let indexLookupMs = 0;
    let rankingMs = 0;
    let resultsCount = 0;
    let filesSearched = 0;
    let cacheHit = false;
    
    try {
      const result = await fn();
      
      // Extract metrics from result if available
      if (typeof result === 'object' && result !== null) {
        const searchResult = result as {
          results?: unknown[];
          stats?: {
            indexLookupMs?: number;
            rankingMs?: number;
            filesSearched?: number;
            cacheHit?: boolean;
          };
        };
        
        resultsCount = searchResult.results?.length ?? 0;
        indexLookupMs = searchResult.stats?.indexLookupMs ?? 0;
        rankingMs = searchResult.stats?.rankingMs ?? 0;
        filesSearched = searchResult.stats?.filesSearched ?? 0;
        cacheHit = searchResult.stats?.cacheHit ?? false;
      }
      
      return result;
    } finally {
      const endTime = this.getHighResolutionTime();
      const totalDurationMs = endTime - startTime;
      
      const benchmark: SearchBenchmark = {
        query,
        searchType,
        totalDurationMs,
        indexLookupMs,
        rankingMs,
        resultsCount,
        filesSearched,
        cacheHit,
      };
      
      this.searchOps.push(benchmark);
      this.enforceRetentionLimit(this.searchOps);
      
      // Update cache stats
      if (this.config.enableCacheMetrics) {
        this.recordCacheAccess('search', cacheHit, totalDurationMs);
      }
      
      this.emitMetric({
        category: 'search',
        name: 'search_time',
        value: totalDurationMs,
        unit: 'ms',
        timestamp: Date.now(),
        tags: { searchType, cacheHit: cacheHit.toString() },
      });
      
      this.emit('benchmark:search', benchmark);
    }
  }

  /* ===========================
   * Memory Tracking
   * =========================== */

  /**
   * Starts memory tracking
   */
  private startMemoryTracking(): void {
    // Take initial snapshot
    this.captureMemorySnapshot();
    
    // Schedule periodic snapshots
    this.memorySnapshotTimer = setInterval(() => {
      this.captureMemorySnapshot();
    }, this.config.memorySnapshotIntervalMs);
  }

  /**
   * Captures a memory snapshot
   */
  private captureMemorySnapshot(): void {
    const mem = memoryUsage();
    
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsedMB: mem.heapUsed / 1024 / 1024,
      heapTotalMB: mem.heapTotal / 1024 / 1024,
      rssMB: mem.rss / 1024 / 1024,
      externalMB: mem.external / 1024 / 1024,
      arrayBuffersMB: mem.arrayBuffers / 1024 / 1024,
    };
    
    this.memorySnapshots.push(snapshot);
    this.enforceRetentionLimit(this.memorySnapshots);
    
    this.emitMetric({
      category: 'memory',
      name: 'heap_used',
      value: snapshot.heapUsedMB,
      unit: 'MB',
      timestamp: snapshot.timestamp,
    });
    
    this.emit('benchmark:memory-snapshot', snapshot);
  }

  /**
   * Gets current memory usage
   */
  public getCurrentMemoryUsage(): MemorySnapshot {
    const mem = memoryUsage();
    
    return {
      timestamp: Date.now(),
      heapUsedMB: mem.heapUsed / 1024 / 1024,
      heapTotalMB: mem.heapTotal / 1024 / 1024,
      rssMB: mem.rss / 1024 / 1024,
      externalMB: mem.external / 1024 / 1024,
      arrayBuffersMB: mem.arrayBuffers / 1024 / 1024,
    };
  }

  /* ===========================
   * Cache Metrics
   * =========================== */

  /**
   * Records a cache access
   * 
   * @param cacheName - Cache name
   * @param hit - Whether it was a cache hit
   * @param latencyMs - Access latency
   */
  private recordCacheAccess(
    cacheName: string,
    hit: boolean,
    latencyMs: number
  ): void {
    if (!this.cacheStats.has(cacheName)) {
      this.cacheStats.set(cacheName, {
        hits: 0,
        misses: 0,
        hitLatencies: [],
        missLatencies: [],
      });
    }
    
    const stats = this.cacheStats.get(cacheName)!;
    
    if (hit) {
      stats.hits++;
      stats.hitLatencies.push(latencyMs);
    } else {
      stats.misses++;
      stats.missLatencies.push(latencyMs);
    }
  }

  /**
   * Gets cache metrics for a specific cache
   * 
   * @param cacheName - Cache name
   * @param cacheSize - Current cache size
   * @param memoryUsageMB - Cache memory usage
   * @returns Cache metrics
   */
  public getCacheMetrics(
    cacheName: string,
    cacheSize: number = 0,
    memoryUsageMB: number = 0
  ): CacheMetrics {
    const stats = this.cacheStats.get(cacheName);
    
    if (!stats) {
      return {
        cacheName,
        totalRequests: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
        avgHitLatencyMs: 0,
        avgMissLatencyMs: 0,
        cacheSize,
        memoryUsageMB,
      };
    }
    
    const totalRequests = stats.hits + stats.misses;
    const hitRate = totalRequests > 0 ? (stats.hits / totalRequests) * 100 : 0;
    
    const avgHitLatency = stats.hitLatencies.length > 0
      ? stats.hitLatencies.reduce((sum, val) => sum + val, 0) / stats.hitLatencies.length
      : 0;
    
    const avgMissLatency = stats.missLatencies.length > 0
      ? stats.missLatencies.reduce((sum, val) => sum + val, 0) / stats.missLatencies.length
      : 0;
    
    return {
      cacheName,
      totalRequests,
      hits: stats.hits,
      misses: stats.misses,
      hitRate,
      avgHitLatencyMs: avgHitLatency,
      avgMissLatencyMs: avgMissLatency,
      cacheSize,
      memoryUsageMB,
    };
  }

  /* ===========================
   * Throughput Tracking
   * =========================== */

  /**
   * Records a file mutation
   */
  public recordFileMutation(): void {
    if (!this.config.enableThroughputTracking) {
      return;
    }
    
    this.throughputFilesMutated++;
  }

  /**
   * Gets current throughput metrics
   */
  public getThroughputMetrics(): ThroughputMetrics {
    const now = Date.now();
    const windowMs = now - this.throughputWindowStart;
    
    const tasksPerSecond = windowMs > 0
      ? (this.throughputTasksCompleted / windowMs) * 1000
      : 0;
    
    const tokensPerSecond = windowMs > 0
      ? (this.throughputTokensProcessed / windowMs) * 1000
      : 0;
    
    const filesPerSecond = windowMs > 0
      ? (this.throughputFilesMutated / windowMs) * 1000
      : 0;
    
    const avgLatency = this.taskLatencies.length > 0
      ? this.taskLatencies.reduce((sum, val) => sum + val, 0) / this.taskLatencies.length
      : 0;
    
    const sortedLatencies = [...this.taskLatencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);
    
    const p95Latency = sortedLatencies[p95Index] ?? 0;
    const p99Latency = sortedLatencies[p99Index] ?? 0;
    
    return {
      windowMs,
      tasksCompleted: this.throughputTasksCompleted,
      tasksPerSecond,
      tokensProcessed: this.throughputTokensProcessed,
      tokensPerSecond,
      filesMutated: this.throughputFilesMutated,
      filesPerSecond,
      avgTaskLatencyMs: avgLatency,
      p95TaskLatencyMs: p95Latency,
      p99TaskLatencyMs: p99Latency,
    };
  }

  /* ===========================
   * Performance Observer
   * =========================== */

  /**
   * Starts Node.js performance observer
   */
  private startPerformanceObserver(): void {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      
      for (const entry of entries) {
        this.handlePerformanceEntry(entry);
      }
    });
    
    this.performanceObserver.observe({ entryTypes: ['measure', 'function'] });
  }

  /**
   * Handles performance entry
   */
  private handlePerformanceEntry(entry: PerformanceEntry): void {
    this.emitMetric({
      category: 'latency',
      name: entry.name,
      value: entry.duration,
      unit: 'ms',
      timestamp: Date.now(),
    });
  }

  /* ===========================
   * Report Generation
   * =========================== */

  /**
   * Generates comprehensive benchmark report
   * 
   * @param periodMs - Reporting period (0 for all-time)
   * @returns Benchmark report
   */
  public generateReport(periodMs: number = 0): BenchmarkReport {
    const now = Date.now();
    const cutoff = periodMs > 0 ? now - periodMs : 0;
    
    // Filter data by period
    const agentExecutions = periodMs > 0
      ? this.agentExecutions.filter(b => 
          (now - b.executionTimeMs) >= cutoff
        )
      : this.agentExecutions;
    
    const contextExtractions = periodMs > 0
      ? this.contextExtractions.filter(b => 
          (now - b.totalTimeMs) >= cutoff
        )
      : this.contextExtractions;
    
    const merkleDAGOps = this.merkleDAGOps;
    const astGraphOps = this.astGraphOps;
    const searchOps = this.searchOps;
    const memorySnapshots = this.memorySnapshots;
    
    // Calculate summary statistics
    const avgAgentExecutionTime = agentExecutions.length > 0
      ? agentExecutions.reduce((sum, b) => sum + b.executionTimeMs, 0) / agentExecutions.length
      : 0;
    
    const avgContextExtractionTime = contextExtractions.length > 0
      ? contextExtractions.reduce((sum, b) => sum + b.totalTimeMs, 0) / contextExtractions.length
      : 0;
    
    const avgMerkleDAGOpTime = merkleDAGOps.length > 0
      ? merkleDAGOps.reduce((sum, b) => sum + b.durationMs, 0) / merkleDAGOps.length
      : 0;
    
    const avgASTGraphOpTime = astGraphOps.length > 0
      ? astGraphOps.reduce((sum, b) => sum + b.durationMs, 0) / astGraphOps.length
      : 0;
    
    const avgSearchOpTime = searchOps.length > 0
      ? searchOps.reduce((sum, b) => sum + b.totalDurationMs, 0) / searchOps.length
      : 0;
    
    const avgMemoryUsage = memorySnapshots.length > 0
      ? memorySnapshots.reduce((sum, s) => sum + s.heapUsedMB, 0) / memorySnapshots.length
      : 0;
    
    const peakMemoryUsage = memorySnapshots.length > 0
      ? Math.max(...memorySnapshots.map(s => s.heapUsedMB))
      : 0;
    
    // Calculate overall cache hit rate
    let totalCacheHits = 0;
    let totalCacheAccesses = 0;
    
    for (const stats of this.cacheStats.values()) {
      totalCacheHits += stats.hits;
      totalCacheAccesses += stats.hits + stats.misses;
    }
    
    const overallCacheHitRate = totalCacheAccesses > 0
      ? (totalCacheHits / totalCacheAccesses) * 100
      : 0;
    
    // Collect cache metrics
    const cacheMetrics: CacheMetrics[] = [];
    for (const cacheName of this.cacheStats.keys()) {
      cacheMetrics.push(this.getCacheMetrics(cacheName));
    }
    
    return {
      timestamp: now,
      periodMs: periodMs || (now - this.startTime),
      agentExecutions,
      contextExtractions,
      merkleDAGOps,
      astGraphOps,
      searchOps,
      memorySnapshots,
      throughput: this.getThroughputMetrics(),
      cacheMetrics,
      summary: {
        totalAgentExecutions: agentExecutions.length,
        avgAgentExecutionTimeMs: avgAgentExecutionTime,
        totalContextExtractions: contextExtractions.length,
        avgContextExtractionTimeMs: avgContextExtractionTime,
        totalMerkleDAGOps: merkleDAGOps.length,
        avgMerkleDAGOpTimeMs: avgMerkleDAGOpTime,
        totalASTGraphOps: astGraphOps.length,
        avgASTGraphOpTimeMs: avgASTGraphOpTime,
        totalSearchOps: searchOps.length,
        avgSearchOpTimeMs: avgSearchOpTime,
        avgMemoryUsageMB: avgMemoryUsage,
        peakMemoryUsageMB: peakMemoryUsage,
        overallCacheHitRate,
      },
    };
  }

  /* ===========================
   * Utilities
   * =========================== */

  /**
   * Gets high-resolution timestamp
   */
  private getHighResolutionTime(): number {
    if (this.config.enableHighResolutionTiming) {
      return performance.now();
    }
    return Date.now();
  }

  /**
   * Emits a performance metric
   */
  private emitMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    this.enforceRetentionLimit(this.metrics);
    this.emit('metric', metric);
  }

  /**
   * Enforces retention limit on array
   */
  private enforceRetentionLimit<T>(array: T[]): void {
    if (array.length > this.config.maxMetricsRetention) {
      array.splice(0, array.length - this.config.maxMetricsRetention);
    }
  }
}

/* ===========================
 * Factory & Exports
 * =========================== */

/**
 * Creates a new SwarmBenchmark instance
 */
export function createSwarmBenchmark(
  config?: SwarmBenchmarkConfig
): SwarmBenchmark {
  return new SwarmBenchmark(config);
}

export default SwarmBenchmark;
