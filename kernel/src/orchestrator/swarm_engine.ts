
export type AgentRole = any;
export type AgentTaskDescriptor = any;
export type AgentContextPayload = any;
export type ISwarmContextBridge = any;

/**
 * @fileoverview SwarmEngine - Unified high-throughput orchestration engine
 * @module kernel/orchestrator
 * 
 * Master entry point integrating SwarmMeshOrchestrator, SwarmContextBridge,
 * and SwarmDeltaObserver into a cohesive multi-agent execution system.
 * 
 * @author Klyn AI OS Core Team
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { resolve } from 'path';
import { promises as fs } from 'fs';

// Indexer Engine imports
import {
  MerkleDAG,
  ASTGraph,
  ContextWeaver,
  HybridSearch,
  createMerkleDAG,
  createASTGraph,
  createContextWeaver,
  createHybridSearch,
} from '../indexer/index';

// Orchestrator components
import {
  SwarmContextBridge,
  createSwarmContextBridge,
  type ISwarmContextBridge,
  type AgentTaskDescriptor,
  type AgentContextPayload,
  type AgentRole,
} from './context_bridge';

import {
  SwarmDeltaObserver,
  createSwarmDeltaObserver,
  type AgentID,
  type ContextDeltaReport,
  type FileMutationEvent,
  type SwarmMeshState,
  type AgentContextMetadata,
} from './swarm_delta_observer';

/* ===========================
 * Type Definitions
 * =========================== */

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Task execution status
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Agent execution mode
 */
export type AgentExecutionMode = 'sequential' | 'parallel' | 'pipeline';

/**
 * Swarm task request - high-level task submitted to engine
 */
export interface SwarmTaskRequest {
  /** Unique task ID */
  readonly taskId: string;
  
  /** Task description/prompt */
  readonly description: string;
  
  /** Target files or directories */
  readonly targets: ReadonlyArray<string>;
  
  /** Task type determining agent roles */
  readonly taskType: 'architect' | 'implement' | 'debug' | 'refactor' | 'analyze';
  
  /** Priority level */
  readonly priority?: TaskPriority;
  
  /** Maximum execution time (ms) */
  readonly timeoutMs?: number;
  
  /** Token budget per agent */
  readonly tokenBudget?: number;
  
  /** Execution mode */
  readonly executionMode?: AgentExecutionMode;
  
  /** Additional metadata */
  readonly metadata?: Readonly<{
    stackTrace?: string;
    errorMessage?: string;
    focusAreas?: ReadonlyArray<string>;
    constraints?: ReadonlyArray<string>;
  }>;
}

/**
 * Agent sub-task - decomposed task for specific agent
 */
export interface AgentSubTask {
  /** Sub-task ID */
  readonly subTaskId: string;
  
  /** Parent task ID */
  readonly parentTaskId: string;
  
  /** Agent role */
  readonly role: AgentRole;
  
  /** Task descriptor for context bridge */
  readonly descriptor: AgentTaskDescriptor;
  
  /** Token budget */
  readonly tokenBudget: number;
  
  /** Dependencies on other sub-tasks */
  readonly dependencies?: ReadonlyArray<string>;
  
  /** Agent ID assigned to this task */
  agentId?: AgentID;
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
  /** Sub-task ID */
  readonly subTaskId: string;
  
  /** Agent ID */
  readonly agentId: AgentID;
  
  /** Execution status */
  readonly status: TaskStatus;
  
  /** Generated/modified files */
  readonly outputFiles: ReadonlyMap<string, string>;
  
  /** Agent reasoning/thoughts */
  readonly reasoning?: string;
  
  /** Execution metrics */
  readonly metrics: Readonly<{
    durationMs: number;
    tokensUsed: number;
    contextTokens: number;
    filesProcessed: number;
  }>;
  
  /** Error if failed */
  readonly error?: Error;
}

/**
 * Swarm execution result - complete task result
 */
export interface SwarmExecutionResult {
  /** Task ID */
  readonly taskId: string;
  
  /** Overall status */
  readonly status: TaskStatus;
  
  /** Sub-task results */
  readonly subTaskResults: ReadonlyArray<AgentExecutionResult>;
  
  /** All generated/modified files */
  readonly outputFiles: ReadonlyMap<string, string>;
  
  /** Execution summary */
  readonly summary: Readonly<{
    totalDurationMs: number;
    totalAgents: number;
    successfulAgents: number;
    failedAgents: number;
    totalTokensUsed: number;
    totalFilesMutated: number;
  }>;
  
  /** Swarm coordination metrics */
  readonly coordinationMetrics: Readonly<{
    contextSyncEvents: number;
    deltaNotifications: number;
    contextRefreshes: number;
    avgSyncLatencyMs: number;
  }>;
  
  /** Error if failed */
  readonly error?: Error;
}

/**
 * Engine metrics - performance and efficiency statistics
 */
export interface EngineMetrics {
  /** Indexer metrics */
  readonly indexer: Readonly<{
    totalFiles: number;
    totalSymbols: number;
    indexingSpeedMs: number;
    lastIndexTime: number;
    merkleDAGNodes: number;
    astGraphNodes: number;
  }>;
  
  /** Context bridge metrics */
  readonly contextBridge: Readonly<{
    totalContextRequests: number;
    avgContextWeavingLatencyMs: number;
    cacheHitRate: number;
    avgTokensPerContext: number;
    totalTokensSaved: number;
  }>;
  
  /** Delta observer metrics */
  readonly deltaObserver: Readonly<{
    totalMutations: number;
    totalDeltas: number;
    totalInvalidations: number;
    avgProcessingTimeMs: number;
  }>;
  
  /** Swarm orchestration metrics */
  readonly orchestration: Readonly<{
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    activeAgents: number;
    avgTaskDurationMs: number;
    concurrentTaskPeak: number;
  }>;
  
  /** Resource usage */
  readonly resources: Readonly<{
    memoryUsageMB: number;
    cpuUsagePercent: number;
    upTimeMs: number;
  }>;
}

/**
 * Engine configuration
 */
export interface SwarmEngineConfig {
  /** Codebase root directory */
  readonly codebaseRoot: string;
  
  /** Maximum concurrent agents */
  readonly maxConcurrentAgents?: number;
  
  /** Default token budget per agent */
  readonly defaultTokenBudget?: number;
  
  /** Enable real-time delta synchronization */
  readonly enableDeltaSync?: boolean;
  
  /** Enable filesystem watching */
  readonly enableFileSystemWatch?: boolean;
  
  /** Indexer warm-start on initialization */
  readonly warmStartIndexer?: boolean;
  
  /** Cache configuration */
  readonly cache?: Readonly<{
    enableContextCache?: boolean;
    maxCacheSize?: number;
    ttlMs?: number;
  }>;
  
  /** Telemetry configuration */
  readonly telemetry?: Readonly<{
    enableMetrics?: boolean;
    metricsIntervalMs?: number;
    enableLogging?: boolean;
  }>;
  
  /** Agent execution configuration */
  readonly agentConfig?: Readonly<{
    defaultTimeoutMs?: number;
    retryAttempts?: number;
    retryDelayMs?: number;
  }>;
}

/**
 * Agent instance representation
 */
interface AgentInstance {
  agentId: AgentID;
  role: AgentRole;
  status: 'idle' | 'busy' | 'error';
  currentTask?: AgentSubTask;
  contextMetadata?: AgentContextMetadata;
  lastActiveTime: number;
}

/**
 * Context cache entry
 */
interface ContextCacheEntry {
  payload: AgentContextPayload;
  timestamp: number;
  hits: number;
}

/**
 * Task execution context
 */
interface TaskExecutionContext {
  taskId: string;
  request: SwarmTaskRequest;
  subTasks: AgentSubTask[];
  results: Map<string, AgentExecutionResult>;
  startTime: number;
  status: TaskStatus;
  outputFiles: Map<string, string>;
}

/* ===========================
 * Main SwarmEngine Implementation
 * =========================== */

/**
 * SwarmEngine - Unified high-throughput multi-agent orchestration system
 * 
 * Integrates Indexer Engine, Context Bridge, and Delta Observer to provide
 * seamless multi-agent task execution with real-time context synchronization.
 * 
 * @example
 * ```typescript
 * const engine = await SwarmEngine.initialize('/path/to/codebase', {
 *   maxConcurrentAgents: 5,
 *   enableDeltaSync: true,
 *   warmStartIndexer: true
 * });
 * 
 * const result = await engine.dispatchTask({
 *   taskId: 'refactor-auth',
 *   description: 'Refactor authentication system',
 *   targets: ['src/auth'],
 *   taskType: 'refactor'
 * });
 * 
 * console.log(`Task completed: ${result.status}`);
 * const metrics = engine.getEngineMetrics();
 * console.log(`Tokens saved: ${metrics.contextBridge.totalTokensSaved}`);
 * ```
 */
export class SwarmEngine extends EventEmitter {
  private readonly config: Required<SwarmEngineConfig>;
  
  // Core components
  private readonly merkleDAG: MerkleDAG;
  private readonly astGraph: ASTGraph;
  private readonly contextWeaver: ContextWeaver;
  private readonly hybridSearch: HybridSearch;
  private readonly contextBridge: ISwarmContextBridge;
  private readonly deltaObserver: SwarmDeltaObserver;
  
  // Swarm state
  private readonly activeAgents: Map<AgentID, AgentInstance>;
  private readonly activeTasks: Map<string, TaskExecutionContext>;
  private readonly taskQueue: SwarmTaskRequest[];
  private meshState: SwarmMeshState;
  
  // Context caching
  private readonly contextCache: Map<string, ContextCacheEntry>;
  
  // Metrics tracking
  private metrics: {
    indexer: {
      totalFiles: number;
      totalSymbols: number;
      indexingSpeedMs: number;
      lastIndexTime: number;
    };
    contextBridge: {
      totalContextRequests: number;
      totalContextWeavingTimeMs: number;
      cacheHits: number;
      cacheMisses: number;
      totalTokensGenerated: number;
    };
    orchestration: {
      totalTasks: number;
      completedTasks: number;
      failedTasks: number;
      totalTaskTimeMs: number;
      concurrentTaskPeak: number;
    };
    coordination: {
      contextSyncEvents: number;
      deltaNotifications: number;
      contextRefreshes: number;
      totalSyncLatencyMs: number;
    };
  };
  
  // State flags
  private isInitialized: boolean;
  private isShuttingDown: boolean;
  private metricsTimer: NodeJS.Timeout | null;
  private readonly startTime: number;

  /**
   * Private constructor - use SwarmEngine.initialize() to create instances
   */
  private constructor(
    config: SwarmEngineConfig,
    merkleDAG: MerkleDAG,
    astGraph: ASTGraph,
    contextWeaver: ContextWeaver,
    hybridSearch: HybridSearch,
    contextBridge: ISwarmContextBridge,
    deltaObserver: SwarmDeltaObserver
  ) {
    super();
    
    this.config = {
      codebaseRoot: resolve(config.codebaseRoot),
      maxConcurrentAgents: config.maxConcurrentAgents ?? 5,
      defaultTokenBudget: config.defaultTokenBudget ?? 8000,
      enableDeltaSync: config.enableDeltaSync ?? true,
      enableFileSystemWatch: config.enableFileSystemWatch ?? true,
      warmStartIndexer: config.warmStartIndexer ?? true,
      cache: {
        enableContextCache: config.cache?.enableContextCache ?? true,
        maxCacheSize: config.cache?.maxCacheSize ?? 100,
        ttlMs: config.cache?.ttlMs ?? 300000, // 5 minutes
      },
      telemetry: {
        enableMetrics: config.telemetry?.enableMetrics ?? true,
        metricsIntervalMs: config.telemetry?.metricsIntervalMs ?? 60000,
        enableLogging: config.telemetry?.enableLogging ?? false,
      },
      agentConfig: {
        defaultTimeoutMs: config.agentConfig?.defaultTimeoutMs ?? 300000, // 5 minutes
        retryAttempts: config.agentConfig?.retryAttempts ?? 2,
        retryDelayMs: config.agentConfig?.retryDelayMs ?? 1000,
      },
    };
    
    this.merkleDAG = merkleDAG;
    this.astGraph = astGraph;
    this.contextWeaver = contextWeaver;
    this.hybridSearch = hybridSearch;
    this.contextBridge = contextBridge;
    this.deltaObserver = deltaObserver;
    
    this.activeAgents = new Map();
    this.activeTasks = new Map();
    this.taskQueue = [];
    this.contextCache = new Map();
    
    this.meshState = {
      agents: new Map(),
      createdAt: Date.now(),
      meshId: this.generateMeshId(),
      agentCount: 0,
    };
    
    this.metrics = {
      indexer: {
        totalFiles: 0,
        totalSymbols: 0,
        indexingSpeedMs: 0,
        lastIndexTime: 0,
      },
      contextBridge: {
        totalContextRequests: 0,
        totalContextWeavingTimeMs: 0,
        cacheHits: 0,
        cacheMisses: 0,
        totalTokensGenerated: 0,
      },
      orchestration: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalTaskTimeMs: 0,
        concurrentTaskPeak: 0,
      },
      coordination: {
        contextSyncEvents: 0,
        deltaNotifications: 0,
        contextRefreshes: 0,
        totalSyncLatencyMs: 0,
      },
    };
    
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.metricsTimer = null;
    this.startTime = Date.now();
    
    this.setupEventHandlers();
  }

  /**
   * Initializes and warm-starts the SwarmEngine
   * 
   * @param codebaseRoot - Root directory of codebase
   * @param config - Engine configuration
   * @returns Promise resolving to initialized SwarmEngine instance
   * @throws {Error} If initialization fails
   */
  public static async initialize(
    codebaseRoot: string,
    config?: Omit<SwarmEngineConfig, 'codebaseRoot'>
  ): Promise<SwarmEngine> {
    const fullConfig: SwarmEngineConfig = {
      codebaseRoot,
      ...config,
    };
    
    const log = (msg: string) => {
      if (fullConfig.telemetry?.enableLogging) {
        console.log(`[SwarmEngine] ${msg}`);
      }
    };
    
    log('Initializing SwarmEngine...');
    
    try {
      // Step 1: Validate codebase root
      await fs.access(codebaseRoot);
      const stats = await fs.stat(codebaseRoot);
      if (!stats.isDirectory()) {
        throw new Error('Codebase root must be a directory');
      }
      
      log('Codebase root validated');
      
      // Step 2: Initialize Indexer Engine components
      log('Initializing Indexer Engine...');
      const indexerStartTime = performance.now();
      
      const merkleDAG = await createMerkleDAG({
        rootPath: codebaseRoot,
        enableCache: true,
      });
      
      const astGraph = await createASTGraph({
        rootPath: codebaseRoot,
        enableCache: true,
      });
      
      const contextWeaver = await createContextWeaver({
        astGraph,
        merkleDAG,
      });
      
      const hybridSearch = await createHybridSearch({
        astGraph,
        contextWeaver,
      });
      
      const indexerEndTime = performance.now();
      log(`Indexer Engine initialized in ${(indexerEndTime - indexerStartTime).toFixed(2)}ms`);
      
      // Step 3: Warm-start indexer if enabled
      if (fullConfig.warmStartIndexer) {
        log('Warm-starting Indexer Engine...');
        const warmStartTime = performance.now();
        
        await merkleDAG.buildIndex();
        await astGraph.buildIndex();
        
        const warmEndTime = performance.now();
        log(`Warm-start completed in ${(warmEndTime - warmStartTime).toFixed(2)}ms`);
      }
      
      // Step 4: Initialize Context Bridge
      log('Initializing Context Bridge...');
      const contextBridge = createSwarmContextBridge(
        merkleDAG,
        astGraph,
        contextWeaver,
        hybridSearch,
        {
          enableLogging: fullConfig.telemetry?.enableLogging,
          charsPerToken: 4,
        }
      );
      
      // Step 5: Initialize Delta Observer
      log('Initializing Delta Observer...');
      const deltaObserver = createSwarmDeltaObserver(
        merkleDAG,
        astGraph,
        {
          workspaceRoot: codebaseRoot,
          enableFileSystemWatch: fullConfig.enableFileSystemWatch,
          enableLogging: fullConfig.telemetry?.enableLogging,
          enableBatching: true,
        }
      );
      
      await deltaObserver.start();
      log('Delta Observer started');
      
      // Step 6: Create engine instance
      const engine = new SwarmEngine(
        fullConfig,
        merkleDAG,
        astGraph,
        contextWeaver,
        hybridSearch,
        contextBridge,
        deltaObserver
      );
      
      // Step 7: Complete initialization
      await engine.completeInitialization();
      
      log('SwarmEngine initialization complete');
      
      return engine;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log(`Initialization failed: ${errorMsg}`);
      throw new Error(`Failed to initialize SwarmEngine: ${errorMsg}`);
    }
  }

  /* ===========================
   * Task Dispatch & Execution
   * =========================== */

  /**
   * Dispatches a high-level task to the swarm
   * 
   * @param request - Swarm task request
   * @returns Promise resolving to execution result
   * @throws {Error} If engine not initialized or task execution fails
   */
  public async dispatchTask(
    request: SwarmTaskRequest
  ): Promise<SwarmExecutionResult> {
    this.ensureInitialized();
    
    this.log(`Dispatching task ${request.taskId}: ${request.description}`);
    this.metrics.orchestration.totalTasks++;
    
    const executionContext: TaskExecutionContext = {
      taskId: request.taskId,
      request,
      subTasks: [],
      results: new Map(),
      startTime: Date.now(),
      status: 'running',
      outputFiles: new Map(),
    };
    
    this.activeTasks.set(request.taskId, executionContext);
    this.updateConcurrentTaskPeak();
    
    try {
      // Step 1: Decompose task into sub-tasks
      const subTasks = await this.decomposeTask(request);
      executionContext.subTasks = subTasks;
      
      this.log(`Task decomposed into ${subTasks.length} sub-tasks`);
      
      // Step 2: Allocate agents to sub-tasks
      await this.allocateAgentsToSubTasks(subTasks);
      
      // Step 3: Generate context for each agent
      const contextPayloads = await this.generateAgentContexts(subTasks);
      
      // Step 4: Execute sub-tasks based on execution mode
      const mode = request.executionMode ?? 'parallel';
      const subTaskResults = await this.executeSubTasks(
        subTasks,
        contextPayloads,
        executionContext,
        mode
      );
      
      // Step 5: Collect results
      const outputFiles = this.collectOutputFiles(subTaskResults);
      executionContext.outputFiles = outputFiles;
      
      // Step 6: Determine overall status
      const status = this.determineOverallStatus(subTaskResults);
      executionContext.status = status;
      
      // Step 7: Build execution result
      const totalDurationMs = Date.now() - executionContext.startTime;
      
      const result: SwarmExecutionResult = {
        taskId: request.taskId,
        status,
        subTaskResults,
        outputFiles,
        summary: {
          totalDurationMs,
          totalAgents: subTasks.length,
          successfulAgents: subTaskResults.filter(r => r.status === 'completed').length,
          failedAgents: subTaskResults.filter(r => r.status === 'failed').length,
          totalTokensUsed: subTaskResults.reduce((sum, r) => sum + r.metrics.tokensUsed, 0),
          totalFilesMutated: outputFiles.size,
        },
        coordinationMetrics: {
          contextSyncEvents: this.metrics.coordination.contextSyncEvents,
          deltaNotifications: this.metrics.coordination.deltaNotifications,
          contextRefreshes: this.metrics.coordination.contextRefreshes,
          avgSyncLatencyMs: this.calculateAvgSyncLatency(),
        },
      };
      
      // Update metrics
      if (status === 'completed') {
        this.metrics.orchestration.completedTasks++;
      } else {
        this.metrics.orchestration.failedTasks++;
      }
      this.metrics.orchestration.totalTaskTimeMs += totalDurationMs;
      
      this.log(
        `Task ${request.taskId} ${status}: ` +
        `${result.summary.successfulAgents}/${result.summary.totalAgents} agents succeeded, ` +
        `${totalDurationMs.toFixed(2)}ms`
      );
      
      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      executionContext.status = 'failed';
      this.metrics.orchestration.failedTasks++;
      
      this.log(`Task ${request.taskId} failed: ${errorObj.message}`);
      
      return {
        taskId: request.taskId,
        status: 'failed',
        subTaskResults: Array.from(executionContext.results.values()),
        outputFiles: executionContext.outputFiles,
        summary: {
          totalDurationMs: Date.now() - executionContext.startTime,
          totalAgents: executionContext.subTasks.length,
          successfulAgents: 0,
          failedAgents: executionContext.subTasks.length,
          totalTokensUsed: 0,
          totalFilesMutated: 0,
        },
        coordinationMetrics: {
          contextSyncEvents: 0,
          deltaNotifications: 0,
          contextRefreshes: 0,
          avgSyncLatencyMs: 0,
        },
        error: errorObj,
      };
    } finally {
      // Cleanup
      this.activeTasks.delete(request.taskId);
      
      // Release agents
      for (const subTask of executionContext.subTasks) {
        if (subTask.agentId) {
          await this.releaseAgent(subTask.agentId);
        }
      }
    }
  }

  /* ===========================
   * Task Decomposition
   * =========================== */

  /**
   * Decomposes high-level task into agent sub-tasks
   */
  private async decomposeTask(
    request: SwarmTaskRequest
  ): Promise<AgentSubTask[]> {
    const subTasks: AgentSubTask[] = [];
    
    switch (request.taskType) {
      case 'architect':
        subTasks.push(...await this.decomposeArchitectTask(request));
        break;
      
      case 'implement':
        subTasks.push(...await this.decomposeImplementTask(request));
        break;
      
      case 'debug':
        subTasks.push(...await this.decomposeDebugTask(request));
        break;
      
      case 'refactor':
        subTasks.push(...await this.decomposeRefactorTask(request));
        break;
      
      case 'analyze':
        subTasks.push(...await this.decomposeAnalyzeTask(request));
        break;
      
      default:
        throw new Error(`Unknown task type: ${request.taskType}`);
    }
    
    return subTasks;
  }

  /**
   * Decomposes architect task
   */
  private async decomposeArchitectTask(
    request: SwarmTaskRequest
  ): Promise<AgentSubTask[]> {
    // Single ARCHITECT agent for high-level design
    return [{
      subTaskId: `${request.taskId}-architect-1`,
      parentTaskId: request.taskId,
      role: 'ARCHITECT',
      descriptor: {
        taskPrompt: request.description,
        targetedFiles: [...request.targets],
        role: 'ARCHITECT',
        metadata: {
          focusAreas: request.metadata?.focusAreas,
        },
      },
      tokenBudget: request.tokenBudget ?? this.config.defaultTokenBudget,
    }];
  }

  /**
   * Decomposes implementation task
   */
  private async decomposeImplementTask(
    request: SwarmTaskRequest
  ): Promise<AgentSubTask[]> {
    const subTasks: AgentSubTask[] = [];
    
    // 1. ARCHITECT for design
    const architectSubTask: AgentSubTask = {
      subTaskId: `${request.taskId}-architect-1`,
      parentTaskId: request.taskId,
      role: 'ARCHITECT',
      descriptor: {
        taskPrompt: `Design architecture for: ${request.description}`,
        targetedFiles: [...request.targets],
        role: 'ARCHITECT',
      },
      tokenBudget: Math.floor((request.tokenBudget ?? this.config.defaultTokenBudget) * 0.3),
    };
    subTasks.push(architectSubTask);
    
    // 2. CODER(s) for implementation - one per target file
    for (let i = 0; i < request.targets.length; i++) {
      const coderSubTask: AgentSubTask = {
        subTaskId: `${request.taskId}-coder-${i + 1}`,
        parentTaskId: request.taskId,
        role: 'CODER',
        descriptor: {
          taskPrompt: `Implement: ${request.description}`,
          targetedFiles: [request.targets[i]],
          role: 'CODER',
          metadata: {
            prioritySymbols: request.metadata?.focusAreas,
          },
        },
        tokenBudget: Math.floor((request.tokenBudget ?? this.config.defaultTokenBudget) * 0.7),
        dependencies: [architectSubTask.subTaskId], // Depends on architect
      };
      subTasks.push(coderSubTask);
    }
    
    return subTasks;
  }

  /**
   * Decomposes debug task
   */
  private async decomposeDebugTask(
    request: SwarmTaskRequest
  ): Promise<AgentSubTask[]> {
    const subTasks: AgentSubTask[] = [];
    
    // 1. DEBUGGER for root cause analysis
    const debuggerSubTask: AgentSubTask = {
      subTaskId: `${request.taskId}-debugger-1`,
      parentTaskId: request.taskId,
      role: 'DEBUGGER',
      descriptor: {
        taskPrompt: request.description,
        targetedFiles: [...request.targets],
        role: 'DEBUGGER',
        metadata: {
          stackTrace: request.metadata?.stackTrace,
          changedFiles: request.targets,
        },
      },
      tokenBudget: Math.floor((request.tokenBudget ?? this.config.defaultTokenBudget) * 0.5),
    };
    subTasks.push(debuggerSubTask);
    
    // 2. CODER for fix implementation
    const coderSubTask: AgentSubTask = {
      subTaskId: `${request.taskId}-coder-1`,
      parentTaskId: request.taskId,
      role: 'CODER',
      descriptor: {
        taskPrompt: `Fix issue: ${request.description}`,
        targetedFiles: [...request.targets],
        role: 'CODER',
      },
      tokenBudget: Math.floor((request.tokenBudget ?? this.config.defaultTokenBudget) * 0.5),
      dependencies: [debuggerSubTask.subTaskId],
    };
    subTasks.push(coderSubTask);
    
    return subTasks;
  }

  /**
   * Decomposes refactor task
   */
  private async decomposeRefactorTask(
    request: SwarmTaskRequest
  ): Promise<AgentSubTask[]> {
    const subTasks: AgentSubTask[] = [];
    
    // 1. ARCHITECT for refactoring plan
    const architectSubTask: AgentSubTask = {
      subTaskId: `${request.taskId}-architect-1`,
      parentTaskId: request.taskId,
      role: 'ARCHITECT',
      descriptor: {
        taskPrompt: `Create refactoring plan for: ${request.description}`,
        targetedFiles: [...request.targets],
        role: 'ARCHITECT',
      },
      tokenBudget: Math.floor((request.tokenBudget ?? this.config.defaultTokenBudget) * 0.3),
    };
    subTasks.push(architectSubTask);
    
    // 2. CODER(s) for refactoring
    for (let i = 0; i < request.targets.length; i++) {
      const coderSubTask: AgentSubTask = {
        subTaskId: `${request.taskId}-coder-${i + 1}`,
        parentTaskId: request.taskId,
        role: 'CODER',
        descriptor: {
          taskPrompt: `Refactor: ${request.description}`,
          targetedFiles: [request.targets[i]],
          role: 'CODER',
        },
        tokenBudget: Math.floor((request.tokenBudget ?? this.config.defaultTokenBudget) * 0.7),
        dependencies: [architectSubTask.subTaskId],
      };
      subTasks.push(coderSubTask);
    }
    
    return subTasks;
  }

  /**
   * Decomposes analyze task
   */
  private async decomposeAnalyzeTask(
    request: SwarmTaskRequest
  ): Promise<AgentSubTask[]> {
    // Single ARCHITECT for analysis
    return [{
      subTaskId: `${request.taskId}-architect-1`,
      parentTaskId: request.taskId,
      role: 'ARCHITECT',
      descriptor: {
        taskPrompt: request.description,
        targetedFiles: [...request.targets],
        role: 'ARCHITECT',
        metadata: {
          focusAreas: request.metadata?.focusAreas,
        },
      },
      tokenBudget: request.tokenBudget ?? this.config.defaultTokenBudget,
    }];
  }

  /* ===========================
   * Agent Management
   * =========================== */

  /**
   * Allocates agents to sub-tasks
   */
  private async allocateAgentsToSubTasks(
    subTasks: AgentSubTask[]
  ): Promise<void> {
    for (const subTask of subTasks) {
      const agent = await this.allocateAgent(subTask.role);
      subTask.agentId = agent.agentId;
    }
  }

  /**
   * Allocates an agent for a specific role
   */
  private async allocateAgent(role: AgentRole): Promise<AgentInstance> {
    // Check if we have idle agent of this role
    for (const agent of this.activeAgents.values()) {
      if (agent.role === role && agent.status === 'idle') {
        agent.status = 'busy';
        agent.lastActiveTime = Date.now();
        return agent;
      }
    }
    
    // Check concurrent agent limit
    if (this.activeAgents.size >= this.config.maxConcurrentAgents) {
      // Wait for agent to become available
      return this.waitForAvailableAgent(role);
    }
    
    // Create new agent
    const agent: AgentInstance = {
      agentId: this.generateAgentId(role),
      role,
      status: 'busy',
      lastActiveTime: Date.now(),
    };
    
    this.activeAgents.set(agent.agentId, agent);
    this.updateMeshState();
    
    this.log(`Allocated new agent: ${agent.agentId} (${role})`);
    
    return agent;
  }

  /**
   * Waits for an available agent
   */
  private async waitForAvailableAgent(role: AgentRole): Promise<AgentInstance> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for available ${role} agent`));
      }, 30000);
      
      const checkInterval = setInterval(() => {
        for (const agent of this.activeAgents.values()) {
          if (agent.role === role && agent.status === 'idle') {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            agent.status = 'busy';
            agent.lastActiveTime = Date.now();
            resolve(agent);
            return;
          }
        }
      }, 100);
    });
  }

  /**
   * Releases an agent back to idle state
   */
  private async releaseAgent(agentId: AgentID): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      return;
    }
    
    agent.status = 'idle';
    agent.currentTask = undefined;
    agent.lastActiveTime = Date.now();
    
    // Unregister from delta observer
    if (this.config.enableDeltaSync) {
      this.deltaObserver.unregisterAgentContext(agentId);
    }
    
    this.log(`Released agent: ${agentId}`);
  }

  /* ===========================
   * Context Generation
   * =========================== */

  /**
   * Generates context payloads for all sub-tasks
   */
  private async generateAgentContexts(
    subTasks: ReadonlyArray<AgentSubTask>
  ): Promise<Map<string, AgentContextPayload>> {
    const contextPayloads = new Map<string, AgentContextPayload>();
    
    // Generate contexts concurrently
    await Promise.all(
      subTasks.map(async (subTask) => {
        const payload = await this.getAgentContext(
          subTask.descriptor,
          subTask.tokenBudget
        );
        contextPayloads.set(subTask.subTaskId, payload);
      })
    );
    
    return contextPayloads;
  }

  /**
   * Gets agent context with caching and backpressure
   */
  private async getAgentContext(
    descriptor: AgentTaskDescriptor,
    tokenBudget: number
  ): Promise<AgentContextPayload> {
    this.checkMemoryPressure();

    const cacheKey = this.generateContextCacheKey(descriptor, tokenBudget);
    
    if (this.config.cache.enableContextCache) {
      const cached = this.contextCache.get(cacheKey);
      if (cached && !this.isCacheExpired(cached)) {
        this.metrics.contextBridge.cacheHits++;
        cached.hits++;
        this.log(`Context cache hit for ${descriptor.role}`);
        return cached.payload;
      }
    }
    
    this.metrics.contextBridge.cacheMisses++;
    this.metrics.contextBridge.totalContextRequests++;
    
    const startTime = performance.now();
    
    const payload = await this.contextBridge.getDynamicContextSlice(
      descriptor,
      tokenBudget
    );
    
    const weavingTime = performance.now() - startTime;
    this.metrics.contextBridge.totalContextWeavingTimeMs += weavingTime;
    this.metrics.contextBridge.totalTokensGenerated += payload.estimatedTokens;
    
    if (this.config.cache.enableContextCache) {
      this.contextCache.set(cacheKey, {
        payload,
        timestamp: Date.now(),
        hits: 0,
      });
      this.enforceCacheLimit();
    }
    
    this.log(
      `Generated context for ${descriptor.role}: ` +
      `${payload.estimatedTokens} tokens, ${weavingTime.toFixed(2)}ms`
    );
    
    return payload;
  }

  /**
   * Checks memory pressure and degrades gracefully under constrained conditions
   */
  private checkMemoryPressure(): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const mem = process.memoryUsage();
      const heapUsedMB = mem.heapUsed / 1024 / 1024;
      const heapTotalMB = mem.heapTotal / 1024 / 1024;
      const ratio = heapUsedMB / heapTotalMB;

      if (ratio > 0.9) {
        this.log(`Memory pressure critical: ${heapUsedMB.toFixed(1)}MB / ${heapTotalMB.toFixed(1)}MB (${(ratio * 100).toFixed(1)}%)`);
        this.enforceCacheLimit();
        this.contextCache.clear();
      } else if (ratio > 0.75) {
        this.log(`Memory pressure elevated: ${heapUsedMB.toFixed(1)}MB / ${heapTotalMB.toFixed(1)}MB (${(ratio * 100).toFixed(1)}%)`);
        this.enforceCacheLimit();
      }
    }
  }

  /**
   * Enforces cache size limit using LRU eviction via Map insertion order
   */
  private enforceCacheLimit(): void {
    const maxSize = this.config.cache.maxCacheSize;
    while (this.contextCache.size > maxSize) {
      const firstKey = this.contextCache.keys().next().value;
      if (firstKey) {
        this.contextCache.delete(firstKey);
      }
    }
  }

  /* ===========================
   * Sub-Task Execution
   * =========================== */

  /**
   * Executes sub-tasks based on execution mode
   */
  private async executeSubTasks(
    subTasks: ReadonlyArray<AgentSubTask>,
    contextPayloads: Map<string, AgentContextPayload>,
    executionContext: TaskExecutionContext,
    mode: AgentExecutionMode
  ): Promise<AgentExecutionResult[]> {
    switch (mode) {
      case 'sequential':
        return this.executeSequential(subTasks, contextPayloads, executionContext);
      
      case 'parallel':
        return this.executeParallel(subTasks, contextPayloads, executionContext);
      
      case 'pipeline':
        return this.executePipeline(subTasks, contextPayloads, executionContext);
      
      default:
        throw new Error(`Unknown execution mode: ${mode}`);
    }
  }

  /**
   * Executes sub-tasks sequentially
   */
  private async executeSequential(
    subTasks: ReadonlyArray<AgentSubTask>,
    contextPayloads: Map<string, AgentContextPayload>,
    executionContext: TaskExecutionContext
  ): Promise<AgentExecutionResult[]> {
    const results: AgentExecutionResult[] = [];
    
    for (const subTask of subTasks) {
      const result = await this.executeAgentSubTask(
        subTask,
        contextPayloads.get(subTask.subTaskId)!,
        executionContext
      );
      results.push(result);
      executionContext.results.set(subTask.subTaskId, result);
      
      // Stop on failure
      if (result.status === 'failed') {
        this.log(`Sequential execution stopped due to failure in ${subTask.subTaskId}`);
        break;
      }
    }
    
    return results;
  }

  /**
   * Executes sub-tasks in parallel with bounded concurrency
   */
  private async executeParallel(
    subTasks: ReadonlyArray<AgentSubTask>,
    contextPayloads: Map<string, AgentContextPayload>,
    executionContext: TaskExecutionContext
  ): Promise<AgentExecutionResult[]> {
    const concurrency = Math.min(
      this.config.maxConcurrentAgents,
      subTasks.length
    );

    const results: AgentExecutionResult[] = new Array(subTasks.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < subTasks.length; i++) {
      const subTask = subTasks[i];
      const promise = this.executeAgentSubTask(
        subTask,
        contextPayloads.get(subTask.subTaskId)!,
        executionContext
      ).then(result => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    await Promise.all(executing);

    for (let i = 0; i < subTasks.length; i++) {
      executionContext.results.set(subTasks[i].subTaskId, results[i]);
    }

    return results;
  }

  /**
   * Executes sub-tasks in pipeline mode (respecting dependencies)
   */
  private async executePipeline(
    subTasks: ReadonlyArray<AgentSubTask>,
    contextPayloads: Map<string, AgentContextPayload>,
    executionContext: TaskExecutionContext
  ): Promise<AgentExecutionResult[]> {
    const completed = new Set<string>();
    const results: AgentExecutionResult[] = [];
    const pending = [...subTasks];
    const concurrency = Math.min(this.config.maxConcurrentAgents, subTasks.length);

    while (pending.length > 0) {
      const ready = pending.filter(task => {
        if (!task.dependencies || task.dependencies.length === 0) {
          return true;
        }
        return task.dependencies.every(dep => completed.has(dep));
      });

      if (ready.length === 0) {
        throw new Error('Circular dependency detected in sub-tasks');
      }

      const batchSize = Math.min(ready.length, concurrency);
      const batch = ready.slice(0, batchSize);
      const batchResults = await this.executeBatchedSubTasks(
        batch,
        contextPayloads,
        executionContext
      );

      for (let i = 0; i < batch.length; i++) {
        const subTask = batch[i];
        const result = batchResults[i];

        completed.add(subTask.subTaskId);
        results.push(result);
        executionContext.results.set(subTask.subTaskId, result);

        const index = pending.indexOf(subTask);
        if (index !== -1) {
          pending.splice(index, 1);
        }

        if (result.status === 'failed') {
          this.log(`Pipeline execution stopped due to failure in ${subTask.subTaskId}`);
          return results;
        }
      }
    }

    return results;
  }

  /**
   * Executes a batch of sub-tasks with bounded concurrency
   */
  private async executeBatchedSubTasks(
    subTasks: ReadonlyArray<AgentSubTask>,
    contextPayloads: Map<string, AgentContextPayload>,
    executionContext: TaskExecutionContext
  ): Promise<AgentExecutionResult[]> {
    const results: AgentExecutionResult[] = new Array(subTasks.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < subTasks.length; i++) {
      const subTask = subTasks[i];
      const promise = this.executeAgentSubTask(
        subTask,
        contextPayloads.get(subTask.subTaskId)!,
        executionContext
      ).then(result => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= this.config.maxConcurrentAgents) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Executes a single agent sub-task
   */
  private async executeAgentSubTask(
    subTask: AgentSubTask,
    context: AgentContextPayload,
    executionContext: TaskExecutionContext
  ): Promise<AgentExecutionResult> {
    const startTime = performance.now();
    
    if (!subTask.agentId) {
      throw new Error('Agent not allocated to sub-task');
    }
    
    const agent = this.activeAgents.get(subTask.agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    
    agent.currentTask = subTask;
    
    this.log(`Executing ${subTask.role} task: ${subTask.subTaskId}`);
    
    try {
      // Register agent context with delta observer
      if (this.config.enableDeltaSync) {
        this.registerAgentWithDeltaObserver(agent, context);
      }
      
      // Execute agent workflow
      const result = await this.executeAgentWorkflow(
        agent,
        subTask,
        context,
        executionContext
      );
      
      const durationMs = performance.now() - startTime;
      
      this.log(
        `${subTask.role} task completed: ${subTask.subTaskId}, ` +
        `${result.outputFiles.size} files, ${durationMs.toFixed(2)}ms`
      );
      
      return {
        subTaskId: subTask.subTaskId,
        agentId: agent.agentId,
        status: 'completed',
        outputFiles: result.outputFiles,
        reasoning: result.reasoning,
        metrics: {
          durationMs,
          tokensUsed: result.tokensUsed,
          contextTokens: context.estimatedTokens,
          filesProcessed: result.outputFiles.size,
        },
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorObj = error instanceof Error ? error : new Error('Unknown error');
      
      this.log(`${subTask.role} task failed: ${subTask.subTaskId}: ${errorObj.message}`);
      
      agent.status = 'error';
      
      return {
        subTaskId: subTask.subTaskId,
        agentId: agent.agentId,
        status: 'failed',
        outputFiles: new Map(),
        metrics: {
          durationMs,
          tokensUsed: 0,
          contextTokens: context.estimatedTokens,
          filesProcessed: 0,
        },
        error: errorObj,
      };
    }
  }

  /**
   * Executes agent workflow (simulated - integrate with actual LLM)
   */
  private async executeAgentWorkflow(
    agent: AgentInstance,
    subTask: AgentSubTask,
    context: AgentContextPayload,
    executionContext: TaskExecutionContext
  ): Promise<{
    outputFiles: Map<string, string>;
    reasoning: string;
    tokensUsed: number;
  }> {
    // This is a simulation. In production, this would:
    // 1. Construct prompt from context payload
    // 2. Call LLM API (OpenAI, Anthropic, etc.)
    // 3. Parse LLM response for code changes
    // 4. Write files and notify delta observer
    
    // Simulated workflow
    await this.simulateWorkDelay(subTask.role);
    
    const outputFiles = new Map<string, string>();
    
    // Simulate file generation
    for (const targetFile of subTask.descriptor.targetedFiles) {
      const simulatedContent = this.generateSimulatedContent(
        targetFile,
        subTask.descriptor.taskPrompt,
        context
      );
      
      outputFiles.set(targetFile, simulatedContent);
      
      // Notify delta observer of file mutation
      if (this.config.enableDeltaSync) {
        await this.handleAgentFileMutation(
          agent.agentId,
          targetFile,
          simulatedContent,
          executionContext
        );
      }
    }
    
    return {
      outputFiles,
      reasoning: `Simulated ${subTask.role} execution for: ${subTask.descriptor.taskPrompt}`,
      tokensUsed: Math.floor(Math.random() * 2000) + 1000, // Simulated
    };
  }

  /**
   * Handles agent file mutation and delta synchronization
   */
  private async handleAgentFileMutation(
    agentId: AgentID,
    filePath: string,
    content: string,
    executionContext: TaskExecutionContext
  ): Promise<void> {
    const syncStartTime = performance.now();
    
    try {
      // Process file mutation through delta observer
      const delta = await this.deltaObserver.handleFileMutation(
        filePath,
        content,
        agentId
      );
      
      const syncLatency = performance.now() - syncStartTime;
      this.metrics.coordination.totalSyncLatencyMs += syncLatency;
      this.metrics.coordination.deltaNotifications++;
      
      // Update output files in execution context
      executionContext.outputFiles.set(filePath, content);
      
      // Handle context invalidation for affected agents
      if (delta.affectedAgents.length > 0) {
        this.metrics.coordination.contextSyncEvents++;
        await this.handleContextInvalidation(delta, executionContext);
      }
      
      this.log(
        `File mutation synced: ${filePath}, ` +
        `${delta.affectedAgents.length} agents affected, ` +
        `${syncLatency.toFixed(2)}ms`
      );
    } catch (error) {
      this.log(`Error handling file mutation: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Handles context invalidation for affected agents
   */
  private async handleContextInvalidation(
    delta: ContextDeltaReport,
    executionContext: TaskExecutionContext
  ): Promise<void> {
    // In a real implementation, this would:
    // 1. Pause affected agents
    // 2. Refresh their context windows
    // 3. Resume execution with updated context
    
    // For simulation, just log
    this.log(
      `Context invalidated for ${delta.affectedAgents.length} agents: ` +
      delta.affectedAgents.join(', ')
    );
    
    this.metrics.coordination.contextRefreshes += delta.affectedAgents.length;
  }

  /**
   * Registers agent with delta observer for context tracking
   */
  private registerAgentWithDeltaObserver(
    agent: AgentInstance,
    context: AgentContextPayload
  ): void {
    const metadata: AgentContextMetadata = {
      agentId: agent.agentId,
      filePathsInContext: new Set(context.fileContents.keys()),
      symbolsInContext: new Set(
        context.astContext.map(node => node.name)
      ),
      lastUpdated: Date.now(),
      role: agent.role,
      taskDescription: agent.currentTask?.descriptor.taskPrompt,
    };
    
    agent.contextMetadata = metadata;
    this.deltaObserver.registerAgentContext(metadata);
  }

  /* ===========================
   * Result Collection
   * =========================== */

  /**
   * Collects output files from sub-task results
   */
  private collectOutputFiles(
    results: ReadonlyArray<AgentExecutionResult>
  ): Map<string, string> {
    const outputFiles = new Map<string, string>();
    
    for (const result of results) {
      for (const [filePath, content] of result.outputFiles) {
        outputFiles.set(filePath, content);
      }
    }
    
    return outputFiles;
  }

  /**
   * Determines overall task status from sub-task results
   */
  private determineOverallStatus(
    results: ReadonlyArray<AgentExecutionResult>
  ): TaskStatus {
    if (results.length === 0) {
      return 'failed';
    }
    
    const allCompleted = results.every(r => r.status === 'completed');
    if (allCompleted) {
      return 'completed';
    }
    
    const anyFailed = results.some(r => r.status === 'failed');
    if (anyFailed) {
      return 'failed';
    }
    
    return 'running';
  }

  /* ===========================
   * Metrics & Telemetry
   * =========================== */

  /**
   * Gets comprehensive engine metrics
   */
  public getEngineMetrics(): EngineMetrics {
    const indexerMetrics = this.getIndexerMetrics();
    const contextBridgeMetrics = this.getContextBridgeMetrics();
    const deltaObserverMetrics = this.deltaObserver.getStats();
    const orchestrationMetrics = this.getOrchestrationMetrics();
    const resourceMetrics = this.getResourceMetrics();
    
    return {
      indexer: indexerMetrics,
      contextBridge: contextBridgeMetrics,
      deltaObserver: {
        totalMutations: deltaObserverMetrics.totalMutations,
        totalDeltas: deltaObserverMetrics.totalDeltas,
        totalInvalidations: deltaObserverMetrics.totalInvalidations,
        avgProcessingTimeMs: deltaObserverMetrics.avgProcessingTimeMs,
      },
      orchestration: orchestrationMetrics,
      resources: resourceMetrics,
    };
  }

  /**
   * Gets indexer-specific metrics
   */
  private getIndexerMetrics(): EngineMetrics['indexer'] {
    return {
      totalFiles: this.metrics.indexer.totalFiles,
      totalSymbols: this.metrics.indexer.totalSymbols,
      indexingSpeedMs: this.metrics.indexer.indexingSpeedMs,
      lastIndexTime: this.metrics.indexer.lastIndexTime,
      merkleDAGNodes: (this.merkleDAG as any).getNodeCount?.() ?? 0,
      astGraphNodes: (this.astGraph as any).getNodeCount?.() ?? 0,
    };
  }

  /**
   * Gets context bridge metrics
   */
  private getContextBridgeMetrics(): EngineMetrics['contextBridge'] {
    const totalRequests = this.metrics.contextBridge.totalContextRequests;
    const avgLatency = totalRequests > 0
      ? this.metrics.contextBridge.totalContextWeavingTimeMs / totalRequests
      : 0;
    
    const totalCacheOps = this.metrics.contextBridge.cacheHits + this.metrics.contextBridge.cacheMisses;
    const cacheHitRate = totalCacheOps > 0
      ? this.metrics.contextBridge.cacheHits / totalCacheOps
      : 0;
    
    const avgTokens = totalRequests > 0
      ? this.metrics.contextBridge.totalTokensGenerated / totalRequests
      : 0;
    
    // Estimate tokens saved vs full codebase injection
    const fullCodebaseTokens = this.estimateFullCodebaseTokens();
    const totalTokensSaved = Math.max(
      0,
      (fullCodebaseTokens * totalRequests) - this.metrics.contextBridge.totalTokensGenerated
    );
    
    return {
      totalContextRequests: totalRequests,
      avgContextWeavingLatencyMs: avgLatency,
      cacheHitRate,
      avgTokensPerContext: avgTokens,
      totalTokensSaved,
    };
  }

  /**
   * Gets orchestration metrics
   */
  private getOrchestrationMetrics(): EngineMetrics['orchestration'] {
    const avgDuration = this.metrics.orchestration.totalTasks > 0
      ? this.metrics.orchestration.totalTaskTimeMs / this.metrics.orchestration.totalTasks
      : 0;
    
    return {
      totalTasks: this.metrics.orchestration.totalTasks,
      completedTasks: this.metrics.orchestration.completedTasks,
      failedTasks: this.metrics.orchestration.failedTasks,
      activeAgents: this.activeAgents.size,
      avgTaskDurationMs: avgDuration,
      concurrentTaskPeak: this.metrics.orchestration.concurrentTaskPeak,
    };
  }

  /**
   * Gets resource usage metrics
   */
  private getResourceMetrics(): EngineMetrics['resources'] {
    const memUsage = process.memoryUsage();
    const memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
    
    // CPU usage would require platform-specific code
    const cpuUsagePercent = 0; // Placeholder
    
    const upTimeMs = Date.now() - this.startTime;
    
    return {
      memoryUsageMB,
      cpuUsagePercent,
      upTimeMs,
    };
  }

  /**
   * Estimates full codebase token count (for savings calculation)
   */
  private estimateFullCodebaseTokens(): number {
    // Rough estimate: 1000 tokens per file average
    return this.metrics.indexer.totalFiles * 1000;
  }

  /**
   * Calculates average sync latency
   */
  private calculateAvgSyncLatency(): number {
    const totalEvents = this.metrics.coordination.contextSyncEvents;
    return totalEvents > 0
      ? this.metrics.coordination.totalSyncLatencyMs / totalEvents
      : 0;
  }

  /* ===========================
   * Initialization & Lifecycle
   * =========================== */

  /**
   * Completes engine initialization
   */
  private async completeInitialization(): Promise<void> {
    // Collect initial indexer metrics
    this.collectIndexerMetrics();
    
    // Start metrics collection if enabled
    if (this.config.telemetry.enableMetrics) {
      this.startMetricsCollection();
    }
    
    this.isInitialized = true;
    this.emit('engine:initialized');
  }

  /**
   * Collects indexer metrics
   */
  private collectIndexerMetrics(): void {
    try {
      this.metrics.indexer.totalFiles = (this.merkleDAG as any).getFileCount?.() ?? 0;
      this.metrics.indexer.totalSymbols = (this.astGraph as any).getSymbolCount?.() ?? 0;
      this.metrics.indexer.lastIndexTime = Date.now();
    } catch (error) {
      this.log('Warning: Failed to collect indexer metrics');
    }
  }

  /**
   * Starts periodic metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      this.collectIndexerMetrics();
      this.emit('engine:metrics', this.getEngineMetrics());
    }, this.config.telemetry.metricsIntervalMs);
  }

  /**
   * Shuts down the engine
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized || this.isShuttingDown) {
      return;
    }
    
    this.log('Shutting down SwarmEngine...');
    this.isShuttingDown = true;
    
    // Stop metrics collection
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    // Cancel active tasks
    for (const [taskId, context] of this.activeTasks) {
      this.log(`Cancelling active task: ${taskId}`);
      context.status = 'cancelled';
    }
    
    // Release all agents
    for (const agentId of this.activeAgents.keys()) {
      await this.releaseAgent(agentId);
    }
    
    // Stop delta observer
    await this.deltaObserver.stop();
    
    // Clear caches
    this.contextCache.clear();
    
    this.isInitialized = false;
    this.isShuttingDown = false;
    
    this.log('SwarmEngine shutdown complete');
    this.emit('engine:shutdown');
  }

  /* ===========================
   * Event Handlers
   * =========================== */

  /**
   * Sets up event handlers
   */
  private setupEventHandlers(): void {
    // Delta observer events
    this.deltaObserver.on('swarm:context-invalidated', (agents, delta) => {
      this.handleDeltaContextInvalidation(agents, delta);
    });
    
    this.deltaObserver.on('swarm:error', (error) => {
      this.log(`Delta observer error: ${this.getErrorMessage(error)}`);
      this.emit('engine:error', error);
    });
  }

  /**
   * Handles context invalidation from delta observer
   */
  private handleDeltaContextInvalidation(
    affectedAgents: ReadonlyArray<AgentID>,
    delta: ContextDeltaReport
  ): void {
    this.log(
      `Context invalidation: ${affectedAgents.length} agents, ` +
      `file: ${delta.mutation.filePath}`
    );
    
    this.emit('engine:context-invalidated', affectedAgents, delta);
  }

  /* ===========================
   * Utilities
   * =========================== */

  /**
   * Ensures engine is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('SwarmEngine not initialized');
    }
    
    if (this.isShuttingDown) {
      throw new Error('SwarmEngine is shutting down');
    }
  }

  /**
   * Updates concurrent task peak
   */
  private updateConcurrentTaskPeak(): void {
    const current = this.activeTasks.size;
    if (current > this.metrics.orchestration.concurrentTaskPeak) {
      this.metrics.orchestration.concurrentTaskPeak = current;
    }
  }

  /**
   * Updates mesh state
   */
  private updateMeshState(): void {
    const agentMetadata = new Map<AgentID, AgentContextMetadata>();
    
    for (const [agentId, agent] of this.activeAgents) {
      if (agent.contextMetadata) {
        agentMetadata.set(agentId, agent.contextMetadata);
      }
    }
    
    this.meshState = {
      agents: agentMetadata,
      createdAt: this.meshState.createdAt,
      meshId: this.meshState.meshId,
      agentCount: this.activeAgents.size,
    };
  }

  /**
   * Generates mesh ID
   */
  private generateMeshId(): string {
    return `mesh-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Generates agent ID
   */
  private generateAgentId(role: AgentRole): AgentID {
    return `agent-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Generates context cache key
   */
  private generateContextCacheKey(
    descriptor: AgentTaskDescriptor,
    tokenBudget: number
  ): string {
    const filesKey = descriptor.targetedFiles.join(',');
    const metaKey = JSON.stringify(descriptor.metadata ?? {});
    return `${descriptor.role}:${tokenBudget}:${filesKey}:${metaKey}`;
  }

  /**
   * Checks if cache entry is expired
   */
  private isCacheExpired(entry: ContextCacheEntry): boolean {
    return Date.now() - entry.timestamp > this.config.cache.ttlMs;
  }

  /**
   * Simulates work delay based on role
   */
  private async simulateWorkDelay(role: AgentRole): Promise<void> {
    const delays: Record<AgentRole, number> = {
      ARCHITECT: 2000,
      CODER: 3000,
      DEBUGGER: 2500,
    };
    
    await new Promise(resolve => setTimeout(resolve, delays[role]));
  }

  /**
   * Generates simulated content
   */
  private generateSimulatedContent(
    filePath: string,
    taskPrompt: string,
    context: AgentContextPayload
  ): string {
    return `// Simulated content for: ${filePath}\n` +
           `// Task: ${taskPrompt}\n` +
           `// Context symbols: ${context.astContext.length}\n` +
           `// Generated at: ${new Date().toISOString()}\n\n` +
           `export const simulatedCode = 'implementation';`;
  }

  /**
   * Logs message if logging enabled
   */
  private log(message: string): void {
    if (this.config.telemetry.enableLogging) {
      console.log(`[SwarmEngine] ${message}`);
    }
  }

  /**
   * Gets error message from unknown error
   */
  private getErrorMessage(error: unknown): string {
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
 * Re-exports
 * =========================== */

export {
  // Context Bridge exports
  SwarmContextBridge,
  createSwarmContextBridge,
  type ISwarmContextBridge,
  type AgentTaskDescriptor,
  type AgentContextPayload,
  type AgentRole,
  
  // Delta Observer exports
  SwarmDeltaObserver,
  createSwarmDeltaObserver,
  type AgentID,
  type ContextDeltaReport,
  type FileMutationEvent,
  type SwarmMeshState,
  type AgentContextMetadata,
};

/* ===========================
 * Default Export
 * =========================== */

export default SwarmEngine;
