// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * @fileoverview SwarmContextBridge - Bridges deterministic Indexer Engine to SwarmMeshOrchestrator
 * @module kernel/orchestrator/context_bridge
 * 
 * Provides role-based dynamic context slicing with strict token budgeting for AI agents.
 * Integrates with Merkle DAG, AST Graph, Context Weaver, and Hybrid Search.
 * 
 * @author Klyn AI OS Core Team
 * @version 1.0.0
 */

import type {
  MerkleDAG,
  ASTGraph,
  ContextWeaver,
  HybridSearch,
  ASTNode,
  ModuleDependency,
  FileNode,
  SearchResult,
} from '../indexer/index';

/* ===========================
 * Type Definitions
 * =========================== */

/**
 * Agent role types defining context retrieval strategies
 */
export type AgentRole = 'ARCHITECT' | 'CODER' | 'DEBUGGER';

/**
 * Task descriptor containing all information needed for context retrieval
 */
export interface AgentTaskDescriptor {
  /** The task prompt or description */
  readonly taskPrompt: string;
  
  /** List of file paths targeted by this task */
  readonly targetedFiles: ReadonlyArray<string>;
  
  /** Agent role determining context strategy */
  readonly role: AgentRole;
  
  /** Optional metadata for specialized context retrieval */
  readonly metadata?: Readonly<{
    /** For DEBUGGER: Error stack trace */
    stackTrace?: string;
    
    /** For DEBUGGER: Changed files for diff analysis */
    changedFiles?: ReadonlyArray<string>;
    
    /** For ARCHITECT: Focus areas (e.g., 'authentication', 'database') */
    focusAreas?: ReadonlyArray<string>;
    
    /** For CODER: Specific symbols to prioritize */
    prioritySymbols?: ReadonlyArray<string>;
  }>;
}

/**
 * AST context information for a specific node
 */
export interface ASTContextNode {
  /** Node type (e.g., 'ClassDeclaration', 'FunctionDeclaration') */
  readonly type: string;
  
  /** Node name/identifier */
  readonly name: string;
  
  /** File path where node is defined */
  readonly filePath: string;
  
  /** Source code snippet */
  readonly sourceCode: string;
  
  /** Relevance score (0-100) */
  readonly relevanceScore: number;
  
  /** Exported symbols from this node */
  readonly exports?: ReadonlyArray<string>;
  
  /** Imported symbols into this node */
  readonly imports?: ReadonlyArray<string>;
  
  /** Type definitions associated with node */
  readonly typeDefinitions?: ReadonlyArray<string>;
  
  /** Line number information */
  readonly position?: Readonly<{
    start: number;
    end: number;
  }>;
}

/**
 * Module dependency information
 */
export interface ModuleDependencyInfo {
  /** Source module path */
  readonly source: string;
  
  /** Target module path */
  readonly target: string;
  
  /** Dependency type */
  readonly type: 'import' | 'export' | 'require' | 'dynamic';
  
  /** Specific symbols in dependency relationship */
  readonly symbols: ReadonlyArray<string>;
  
  /** Whether this is a type-only import */
  readonly isTypeOnly?: boolean;
}

/**
 * Merkle DAG diff information
 */
export interface MerkleDiff {
  /** File path */
  readonly filePath: string;
  
  /** Change type */
  readonly changeType: 'added' | 'modified' | 'deleted';
  
  /** Hash before change */
  readonly previousHash?: string;
  
  /** Hash after change */
  readonly currentHash: string;
  
  /** Affected line ranges */
  readonly lineRanges: ReadonlyArray<Readonly<{
    start: number;
    end: number;
  }>>;
}

/**
 * Complete context payload returned to swarm agents
 */
export interface AgentContextPayload {
  /** Original task descriptor */
  readonly task: AgentTaskDescriptor;
  
  /** Primary file contents */
  readonly fileContents: ReadonlyMap<string, string>;
  
  /** AST context nodes sorted by relevance */
  readonly astContext: ReadonlyArray<ASTContextNode>;
  
  /** Module dependency graph */
  readonly dependencies: ReadonlyArray<ModuleDependencyInfo>;
  
  /** Merkle DAG diffs (for DEBUGGER role) */
  readonly diffs?: ReadonlyArray<MerkleDiff>;
  
  /** Estimated token count of entire payload */
  readonly estimatedTokens: number;
  
  /** Whether context was pruned to fit budget */
  readonly wasPruned: boolean;
  
  /** Statistics about pruning */
  readonly pruningStats?: Readonly<{
    totalNodes: number;
    includedNodes: number;
    prunedNodes: number;
  }>;
  
  /** Additional metadata */
  readonly metadata: Readonly<{
    retrievalTimestamp: number;
    retrievalDurationMs: number;
    indexerVersion: string;
    contextStrategy: string;
  }>;
}

/**
 * Interface for SwarmContextBridge
 */
export interface ISwarmContextBridge {
  /**
   * Retrieves a dynamic context slice based on task descriptor and token budget
   * 
   * @param task - Agent task descriptor
   * @param maxTokenBudget - Maximum tokens allowed in context
   * @returns Promise resolving to agent context payload
   * @throws {Error} If task validation fails or indexer operations error
   */
  getDynamicContextSlice(
    task: AgentTaskDescriptor,
    maxTokenBudget: number
  ): Promise<AgentContextPayload>;
}

/**
 * Configuration for SwarmContextBridge
 */
export interface SwarmContextBridgeConfig {
  /** Characters per token estimation (default: 4) */
  readonly charsPerToken?: number;
  
  /** Maximum AST depth for traversal (default: 10) */
  readonly maxASTDepth?: number;
  
  /** Maximum sibling modules to fetch (default: 5) */
  readonly maxSiblingModules?: number;
  
  /** Maximum dependency tree depth (default: 3) */
  readonly maxDependencyDepth?: number;
  
  /** Enable verbose logging */
  readonly enableLogging?: boolean;
  
  /** Indexer engine version */
  readonly indexerVersion?: string;
}

/**
 * Internal raw context data structure before budgeting
 */
interface RawContextData {
  fileContents: Map<string, string>;
  astNodes: ASTContextNode[];
  dependencies: ModuleDependencyInfo[];
  diffs: MerkleDiff[];
}

/**
 * Context retrieval statistics
 */
interface ContextRetrievalStats {
  totalNodes: number;
  prunedNodes: number;
  tokenBudgetUsed: number;
  tokenBudgetLimit: number;
}

/* ===========================
 * Main Implementation
 * =========================== */

/**
 * SwarmContextBridge - Bridges deterministic Indexer Engine to SwarmMeshOrchestrator
 * 
 * Provides role-based dynamic context slicing with strict token budgeting for AI agents.
 * 
 * @example
 * ```typescript
 * const bridge = new SwarmContextBridge(
 *   merkleDAG,
 *   astGraph,
 *   contextWeaver,
 *   hybridSearch
 * );
 * 
 * const context = await bridge.getDynamicContextSlice({
 *   taskPrompt: 'Refactor authentication logic',
 *   targetedFiles: ['src/auth/login.ts'],
 *   role: 'CODER'
 * }, 8000);
 * ```
 */
export class SwarmContextBridge implements ISwarmContextBridge {
  private readonly merkleDAG: MerkleDAG;
  private readonly astGraph: ASTGraph;
  private readonly contextWeaver: ContextWeaver;
  private readonly hybridSearch: HybridSearch;
  private readonly config: Required<SwarmContextBridgeConfig>;

  /**
   * Creates a new SwarmContextBridge instance
   * 
   * @param merkleDAG - Merkle DAG instance for content-addressable storage
   * @param astGraph - AST Graph instance for code structure analysis
   * @param contextWeaver - Context Weaver for intelligent context assembly
   * @param hybridSearch - Hybrid Search for semantic + symbolic search
   * @param config - Optional configuration
   */
  constructor(
    merkleDAG: MerkleDAG,
    astGraph: ASTGraph,
    contextWeaver: ContextWeaver,
    hybridSearch: HybridSearch,
    config: SwarmContextBridgeConfig = {}
  ) {
    this.merkleDAG = merkleDAG;
    this.astGraph = astGraph;
    this.contextWeaver = contextWeaver;
    this.hybridSearch = hybridSearch;
    
    this.config = {
      charsPerToken: config.charsPerToken ?? 4,
      maxASTDepth: config.maxASTDepth ?? 10,
      maxSiblingModules: config.maxSiblingModules ?? 5,
      maxDependencyDepth: config.maxDependencyDepth ?? 3,
      enableLogging: config.enableLogging ?? false,
      indexerVersion: config.indexerVersion ?? '1.0.0',
    };
  }

  /**
   * Retrieves a dynamic context slice based on task descriptor and token budget
   * 
   * @param task - Agent task descriptor
   * @param maxTokenBudget - Maximum tokens allowed in context
   * @returns Promise resolving to agent context payload
   * @throws {Error} If task validation fails or indexer operations error
   */
  public async getDynamicContextSlice(
    task: AgentTaskDescriptor,
    maxTokenBudget: number
  ): Promise<AgentContextPayload> {
    const startTime = performance.now();
    
    this.validateTask(task);
    this.validateTokenBudget(maxTokenBudget);

    const stats: ContextRetrievalStats = {
      totalNodes: 0,
      prunedNodes: 0,
      tokenBudgetUsed: 0,
      tokenBudgetLimit: maxTokenBudget,
    };

    try {
      this.log(`Starting context retrieval for role: ${task.role}`);
      this.log(`Target files: ${task.targetedFiles.join(', ')}`);
      
      // Execute role-based context retrieval strategy
      const rawContext = await this.executeRoleBasedRetrieval(task);
      stats.totalNodes = rawContext.astNodes.length;
      
      this.log(`Retrieved ${stats.totalNodes} AST nodes before budgeting`);
      
      // Apply token budgeting and pruning
      const prunedContext = await this.applyTokenBudgeting(
        rawContext,
        maxTokenBudget,
        stats
      );
      
      // Assemble final payload
      const payload = this.assembleContextPayload(
        task,
        prunedContext,
        stats,
        performance.now() - startTime
      );
      
      this.log(
        `Context retrieval complete. ` +
        `Tokens: ${payload.estimatedTokens}/${maxTokenBudget}, ` +
        `Duration: ${payload.metadata.retrievalDurationMs.toFixed(2)}ms`
      );
      
      return payload;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      this.log(`Error during context retrieval: ${errorMsg}`);
      throw new Error(
        `Failed to retrieve context for role ${task.role}: ${errorMsg}`
      );
    }
  }

  /* ===========================
   * Role-Based Retrieval Strategies
   * =========================== */

  /**
   * Executes role-based context retrieval strategy
   */
  private async executeRoleBasedRetrieval(
    task: AgentTaskDescriptor
  ): Promise<RawContextData> {
    switch (task.role) {
      case 'ARCHITECT':
        return this.retrieveArchitectContext(task);
      
      case 'CODER':
        return this.retrieveCoderContext(task);
      
      case 'DEBUGGER':
        return this.retrieveDebuggerContext(task);
      
      default:
        // Type system ensures this never happens, but defensive coding
        throw new Error(`Unknown agent role: ${task.role}`);
    }
  }

  /**
   * Retrieves context for ARCHITECT role
   * 
   * Strategy:
   * - Top-level AST topology
   * - Exported interface declarations
   * - Module dependency trees
   * - High-level system structure
   */
  private async retrieveArchitectContext(
    task: AgentTaskDescriptor
  ): Promise<RawContextData> {
    this.log('Executing ARCHITECT context strategy');
    
    const fileContents = new Map<string, string>();
    const astNodes: ASTContextNode[] = [];
    const dependencies: ModuleDependencyInfo[] = [];

    // Get top-level topology for all targeted files
    for (const filePath of task.targetedFiles) {
      try {
        const content = await (this.merkleDAG as any).getFileContent(filePath);
        if (content) {
          fileContents.set(filePath, content);
        }

        // Extract top-level AST nodes (classes, interfaces, exports)
        const topLevelNodes = await (this.astGraph as any).getTopLevelNodes(filePath);
        
        for (const node of topLevelNodes) {
          // Filter for exported declarations only
          if (this.isExportedOrPublic(node)) {
            astNodes.push(
              this.convertToASTContextNode(node, filePath, 80) // High relevance
            );
          }
        }

        // Get module dependencies
        const fileDeps = await this.astGraph.getDependencies(filePath);
        dependencies.push(
          ...Array.from(fileDeps || []).map((dep: any) => this.convertToDependencyInfo(typeof dep === "string" ? dep : dep?.target || dep))
        );
      } catch (error) {
        this.log(`Warning: Failed to process ${filePath}: ${this.getErrorMessage(error)}`);
      }
    }

    // Expand to include interface and type definitions
    const typeDefinitions = await this.expandTypeDefinitions(astNodes);
    astNodes.push(...typeDefinitions);

    // Build complete dependency tree
    const dependencyTree = await this.buildDependencyTree(
      task.targetedFiles,
      this.config.maxDependencyDepth
    );
    dependencies.push(...dependencyTree);

    // Apply focus areas if specified
    if (task.metadata?.focusAreas) {
      await this.applyFocusAreas(astNodes, task.metadata.focusAreas);
    }

    this.log(`ARCHITECT context: ${astNodes.length} nodes, ${dependencies.length} deps`);

    return {
      fileContents,
      astNodes,
      dependencies,
      diffs: [],
    };
  }

  /**
   * Retrieves context for CODER role
   * 
   * Strategy:
   * - Immediate file content with full detail
   * - Exact AST symbols (imports/exports)
   * - Type definitions and signatures
   * - Sibling module signatures via Hybrid Search
   */
  private async retrieveCoderContext(
    task: AgentTaskDescriptor
  ): Promise<RawContextData> {
    this.log('Executing CODER context strategy');
    
    const fileContents = new Map<string, string>();
    const astNodes: ASTContextNode[] = [];
    const dependencies: ModuleDependencyInfo[] = [];

    // Get immediate file content with full AST detail
    for (const filePath of task.targetedFiles) {
      try {
        const content = await (this.merkleDAG as any).getFileContent(filePath);
        if (content) {
          fileContents.set(filePath, content);
        }

        // Extract ALL AST symbols for targeted files
        const symbols = await (this.astGraph as any).getAllSymbols(filePath);
        
        for (const symbol of symbols) {
          astNodes.push(
            this.convertToASTContextNode(symbol, filePath, 90) // Very high relevance
          );
        }

        // Get precise imports and exports
        const imports = await (this.astGraph as any).getImports(filePath);
        const exports = await (this.astGraph as any).getExports(filePath);
        
        dependencies.push(
          ...imports.map(imp => this.convertToDependencyInfo(imp)),
          ...exports.map(exp => this.convertToDependencyInfo(exp))
        );
      } catch (error) {
        this.log(`Warning: Failed to process ${filePath}: ${this.getErrorMessage(error)}`);
      }
    }

    // Fetch complete type definitions for all symbols
    const typeDefinitions = await this.fetchTypeDefinitions(astNodes);
    astNodes.push(...typeDefinitions);

    // Use Hybrid Search to find related sibling modules
    const siblingModules = await this.findSiblingModules(
      task.targetedFiles,
      task.taskPrompt
    );
    
    for (const siblingPath of siblingModules) {
      try {
        const signatures = await this.extractModuleSignatures(siblingPath);
        astNodes.push(...signatures);
      } catch (error) {
        this.log(`Warning: Failed to extract signatures from ${siblingPath}`);
      }
    }

    // Prioritize symbols if specified in metadata
    if (task.metadata?.prioritySymbols && task.metadata.prioritySymbols.length > 0) {
      this.prioritizeSymbols(astNodes, task.metadata.prioritySymbols);
    }

    this.log(`CODER context: ${astNodes.length} nodes, ${dependencies.length} deps`);

    return {
      fileContents,
      astNodes,
      dependencies,
      diffs: [],
    };
  }

  /**
   * Retrieves context for DEBUGGER role
   * 
   * Strategy:
   * - Bug trace context via DFS along call stacks
   * - Merkle DAG diffs for changed files
   * - Error propagation paths
   * - Related failure contexts
   */
  private async retrieveDebuggerContext(
    task: AgentTaskDescriptor
  ): Promise<RawContextData> {
    this.log('Executing DEBUGGER context strategy');
    
    const fileContents = new Map<string, string>();
    const astNodes: ASTContextNode[] = [];
    const dependencies: ModuleDependencyInfo[] = [];
    const diffs: MerkleDiff[] = [];

    // Parse stack trace if provided, otherwise use targeted files
    const callStack = task.metadata?.stackTrace
      ? this.parseStackTrace(task.metadata.stackTrace)
      : [...task.targetedFiles];

    this.log(`Call stack depth: ${callStack.length}`);

    // Execute DFS along call stack to build execution context
    for (const filePath of callStack) {
      try {
        const content = await (this.merkleDAG as any).getFileContent(filePath);
        if (content) {
          fileContents.set(filePath, content);
        }

        // Get call graph via DFS
        const callGraphNodes = await (this.astGraph as any).getCallGraphDFS(
          filePath,
          this.config.maxASTDepth
        );
        
        for (const node of callGraphNodes) {
          astNodes.push(
            this.convertToASTContextNode(node, filePath, 85) // High relevance for call graph
          );
        }
      } catch (error) {
        this.log(`Warning: Failed to process call stack file ${filePath}`);
      }
    }

    // Get Merkle DAG diffs for changed files
    if (task.metadata?.changedFiles && task.metadata.changedFiles.length > 0) {
      for (const changedFile of task.metadata.changedFiles) {
        try {
          const diff = await (this.merkleDAG as any).getDiff(changedFile);
          if (diff) {
            diffs.push(this.convertToMerkleDiff(diff));
          }
        } catch (error) {
          this.log(`Warning: Failed to get diff for ${changedFile}`);
        }
      }
    }

    // Trace dependencies through call stack
    const callStackDeps = await this.traceDependenciesThroughCallStack(callStack);
    dependencies.push(...callStackDeps);

    // Weave error context using Context Weaver
    if (task.metadata?.stackTrace) {
      try {
        const errorContext = await this.weaveErrorContext(
          task.taskPrompt,
          task.metadata.stackTrace
        );
        astNodes.push(...errorContext);
      } catch (error) {
        this.log('Warning: Failed to weave error context');
      }
    }

    this.log(
      `DEBUGGER context: ${astNodes.length} nodes, ${dependencies.length} deps, ${diffs.length} diffs`
    );

    return {
      fileContents,
      astNodes,
      dependencies,
      diffs,
    };
  }

  /* ===========================
   * Token Budgeting & Pruning
   * =========================== */

  /**
   * Applies token budgeting and prunes context to fit within limits
   */
  private async applyTokenBudgeting(
    rawContext: RawContextData,
    maxTokenBudget: number,
    stats: ContextRetrievalStats
  ): Promise<RawContextData> {
    // Calculate initial token count
    const currentTokens = this.estimateTokens(rawContext);
    stats.totalNodes = rawContext.astNodes.length;
    stats.tokenBudgetUsed = currentTokens;

    if (currentTokens <= maxTokenBudget) {
      this.log(`Context fits within budget: ${currentTokens}/${maxTokenBudget} tokens`);
      return rawContext;
    }

    this.log(
      `Context exceeds budget: ${currentTokens}/${maxTokenBudget} tokens. ` +
      `Initiating intelligent pruning...`
    );

    // Calculate base token cost (file contents + dependencies + diffs)
    const baseTokens = this.estimateBaseTokens(rawContext);
    const availableForAST = maxTokenBudget - baseTokens;

    if (availableForAST < 0) {
      throw new Error(
        `Cannot fit context within budget. Base cost (${baseTokens}) exceeds limit (${maxTokenBudget})`
      );
    }

    // Rank AST nodes by relevance
    const rankedNodes = this.rankNodesByRelevance(rawContext.astNodes);
    
    // Prune low-relevance nodes until we fit budget
    const prunedNodes: ASTContextNode[] = [];
    let accumulatedTokens = 0;

    for (const node of rankedNodes) {
      const nodeTokens = this.estimateNodeTokens(node);
      
      if (accumulatedTokens + nodeTokens <= availableForAST) {
        prunedNodes.push(node);
        accumulatedTokens += nodeTokens;
      } else {
        stats.prunedNodes++;
      }
    }

    stats.tokenBudgetUsed = baseTokens + accumulatedTokens;

    this.log(
      `Pruning complete: kept ${prunedNodes.length}/${rankedNodes.length} nodes, ` +
      `final tokens: ${stats.tokenBudgetUsed}/${maxTokenBudget}`
    );

    return {
      ...rawContext,
      astNodes: prunedNodes,
    };
  }

  /**
   * Estimates total tokens in raw context data
   */
  private estimateTokens(context: RawContextData): number {
    let total = 0;

    // File contents
    for (const content of context.fileContents.values()) {
      total += Math.ceil(content.length / this.config.charsPerToken);
    }

    // AST nodes
    for (const node of context.astNodes) {
      total += this.estimateNodeTokens(node);
    }

    // Dependencies (approximate: source + target + symbols)
    for (const dep of context.dependencies) {
      total += Math.ceil(
        (dep.source.length + dep.target.length + dep.symbols.join(',').length) /
        this.config.charsPerToken
      );
    }

    // Diffs
    for (const diff of context.diffs) {
      total += Math.ceil(diff.filePath.length / this.config.charsPerToken);
      total += diff.lineRanges.length * 5; // ~5 tokens per line range metadata
    }

    return total;
  }

  /**
   * Estimates base tokens (without AST nodes)
   */
  private estimateBaseTokens(context: RawContextData): number {
    let total = 0;

    // File contents (non-compressible)
    for (const content of context.fileContents.values()) {
      total += Math.ceil(content.length / this.config.charsPerToken);
    }

    // Dependencies
    for (const dep of context.dependencies) {
      total += Math.ceil(
        (dep.source.length + dep.target.length + dep.symbols.join(',').length) /
        this.config.charsPerToken
      );
    }

    // Diffs
    for (const diff of context.diffs) {
      total += Math.ceil(diff.filePath.length / this.config.charsPerToken);
      total += diff.lineRanges.length * 5;
    }

    return total;
  }

  /**
   * Estimates tokens for a single AST node
   */
  private estimateNodeTokens(node: ASTContextNode): number {
    const { charsPerToken } = this.config;
    let total = 0;
    
    total += Math.ceil(node.type.length / charsPerToken);
    total += Math.ceil(node.name.length / charsPerToken);
    total += Math.ceil(node.filePath.length / charsPerToken);
    total += Math.ceil(node.sourceCode.length / charsPerToken);
    
    if (node.exports) {
      total += Math.ceil(node.exports.join(',').length / charsPerToken);
    }
    
    if (node.imports) {
      total += Math.ceil(node.imports.join(',').length / charsPerToken);
    }
    
    if (node.typeDefinitions) {
      for (const typeDef of node.typeDefinitions) {
        total += Math.ceil(typeDef.length / charsPerToken);
      }
    }
    
    return total;
  }

  /**
   * Ranks AST nodes by relevance score (descending)
   */
  private rankNodesByRelevance(nodes: ASTContextNode[]): ASTContextNode[] {
    return [...nodes].sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Calculates relevance score for an AST node (0-100)
   */
  private calculateRelevanceScore(
    node: ASTNode,
    baseScore: number
  ): number {
    let score = baseScore;

    // Boost for exported symbols (public API)
    if (node.modifiers?.some(mod => mod === 'export')) {
      score += 10;
    }

    // Boost for nodes with type definitions
    if (node.types && node.types.length > 0) {
      score += 5;
    }

    // Boost based on node type importance
    const typeBoost = this.getNodeTypeBoost(node.kind);
    score += typeBoost;

    // Penalize very large nodes (likely auto-generated or verbose)
    const codeLength = node.text?.length ?? 0;
    if (codeLength > 5000) {
      score -= 10;
    } else if (codeLength > 2000) {
      score -= 5;
    }

    // Boost for nodes with documentation
    if (node.documentation && node.documentation.length > 0) {
      score += 3;
    }

    // Ensure score stays in valid range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Gets relevance boost based on node type
   */
  private getNodeTypeBoost(nodeType: string): number {
    const boosts: Record<string, number> = {
      'ClassDeclaration': 8,
      'InterfaceDeclaration': 8,
      'TypeAliasDeclaration': 7,
      'EnumDeclaration': 6,
      'FunctionDeclaration': 6,
      'MethodDeclaration': 5,
      'PropertyDeclaration': 4,
      'VariableDeclaration': 3,
      'ImportDeclaration': 2,
      'ExportDeclaration': 2,
    };

    return boosts[nodeType] ?? 1;
  }

  /* ===========================
   * Helper Methods
   * =========================== */

  /**
   * Checks if AST node is exported or public
   */
  private isExportedOrPublic(node: ASTNode): boolean {
    if (!node.modifiers) {
      return false;
    }
    
    return node.modifiers.some(
      mod => mod === 'export' || mod === 'public' || mod === 'default'
    );
  }

  /**
   * Converts AST node to context node format with relevance scoring
   */
  private convertToASTContextNode(
    node: ASTNode,
    filePath: string,
    baseScore: number = 50
  ): ASTContextNode {
    return {
      type: node.kind,
      name: node.name ?? 'anonymous',
      filePath,
      sourceCode: node.text ?? '',
      relevanceScore: this.calculateRelevanceScore(node, baseScore),
      exports: node.exports?.map(exp => exp.name) ?? undefined,
      imports: node.imports?.map(imp => imp.name) ?? undefined,
      typeDefinitions: node.types?.map(type => type.text) ?? undefined,
      position: node.position ? {
        start: node.position.start,
        end: node.position.end,
      } : undefined,
    };
  }

  /**
   * Converts dependency to info format
   */
  private convertToDependencyInfo(dep: ModuleDependency): ModuleDependencyInfo {
    return {
      source: dep.source,
      target: (dep as any).target || dep,
      type: this.normalizeDependencyType(dep.kind),
      symbols: dep.symbols ?? [],
      isTypeOnly: dep.isTypeOnly ?? false,
    };
  }

  /**
   * Normalizes dependency type to standard format
   */
  private normalizeDependencyType(
    kind: string
  ): 'import' | 'export' | 'require' | 'dynamic' {
    const normalized = kind.toLowerCase();
    
    if (normalized.includes('import')) return 'import';
    if (normalized.includes('export')) return 'export';
    if (normalized.includes('require')) return 'require';
    if (normalized.includes('dynamic')) return 'dynamic';
    
    return 'import'; // Default
  }

  /**
   * Converts diff to Merkle diff format
   */
  private convertToMerkleDiff(diff: FileNode): MerkleDiff {
    return {
      filePath: diff.path,
      changeType: diff.changeType ?? 'modified',
      previousHash: diff.previousHash,
      currentHash: diff.hash,
      lineRanges: diff.changes?.map(change => ({
        start: change.startLine,
        end: change.endLine,
      })) ?? [],
    };
  }

  /**
   * Expands type definitions from AST nodes
   */
  private async expandTypeDefinitions(
    nodes: ASTContextNode[]
  ): Promise<ASTContextNode[]> {
    const typeNodes: ASTContextNode[] = [];
    const processedTypes = new Set<string>();

    for (const node of nodes) {
      if (!node.typeDefinitions) {
        continue;
      }

      for (const typeDef of node.typeDefinitions) {
        if (processedTypes.has(typeDef)) {
          continue;
        }

        try {
          const typeNode = await (this.astGraph as any).getTypeDefinition(typeDef);
          if (typeNode) {
            typeNodes.push(
              this.convertToASTContextNode(typeNode, node.filePath, 70)
            );
            processedTypes.add(typeDef);
          }
        } catch (error) {
          this.log(`Warning: Failed to expand type definition ${typeDef}`);
        }
      }
    }

    return typeNodes;
  }

  /**
   * Builds complete dependency tree for files
   */
  private async buildDependencyTree(
    files: ReadonlyArray<string>,
    maxDepth: number
  ): Promise<ModuleDependencyInfo[]> {
    const dependencies: ModuleDependencyInfo[] = [];
    const visited = new Set<string>();

    for (const file of files) {
      await this.buildDependencyTreeRecursive(
        file,
        dependencies,
        visited,
        0,
        maxDepth
      );
    }

    return dependencies;
  }

  /**
   * Recursively builds dependency tree
   */
  private async buildDependencyTreeRecursive(
    file: string,
    dependencies: ModuleDependencyInfo[],
    visited: Set<string>,
    depth: number,
    maxDepth: number
  ): Promise<void> {
    if (visited.has(file) || depth >= maxDepth) {
      return;
    }

    visited.add(file);

    try {
      const fileDeps = await this.astGraph.getDependencies(file);
      
      for (const dep of fileDeps) {
        const depInfo = this.convertToDependencyInfo(dep);
        dependencies.push(depInfo);
        
        // Recurse into dependency
        await this.buildDependencyTreeRecursive(
          (dep as any).target || dep,
          dependencies,
          visited,
          depth + 1,
          maxDepth
        );
      }
    } catch (error) {
      this.log(`Warning: Failed to build dependency tree for ${file}`);
    }
  }

  /**
   * Applies focus areas to boost relevance of matching nodes
   */
  private async applyFocusAreas(
    nodes: ASTContextNode[],
    focusAreas: ReadonlyArray<string>
  ): Promise<void> {
    for (const node of nodes) {
      for (const area of focusAreas) {
        const areaLower = area.toLowerCase();
        
        if (
          node.name.toLowerCase().includes(areaLower) ||
          node.filePath.toLowerCase().includes(areaLower) ||
          node.sourceCode.toLowerCase().includes(areaLower)
        ) {
          // Boost relevance for nodes matching focus areas
          (node as { relevanceScore: number }).relevanceScore = Math.min(
            100,
            node.relevanceScore + 15
          );
        }
      }
    }
  }

  /**
   * Fetches type definitions for AST nodes
   */
  private async fetchTypeDefinitions(
    nodes: ASTContextNode[]
  ): Promise<ASTContextNode[]> {
    const typeNodes: ASTContextNode[] = [];
    const processedTypes = new Set<string>();

    for (const node of nodes) {
      if (!node.typeDefinitions) {
        continue;
      }

      for (const typeDef of node.typeDefinitions) {
        if (processedTypes.has(typeDef)) {
          continue;
        }

        try {
          const typeNode = await (this.astGraph as any).getTypeDefinition(typeDef);
          if (typeNode) {
            typeNodes.push(
              this.convertToASTContextNode(typeNode, node.filePath, 65)
            );
            processedTypes.add(typeDef);
          }
        } catch (error) {
          // Silently skip failed type definitions
        }
      }
    }

    return typeNodes;
  }

  /**
   * Finds sibling modules using hybrid search
   */
  private async findSiblingModules(
    targetFiles: ReadonlyArray<string>,
    taskPrompt: string
  ): Promise<string[]> {
    try {
      const searchRes: any = await (this.hybridSearch as any).search(taskPrompt);
      const results: SearchResult[] = Array.isArray(searchRes) ? searchRes : (searchRes?.results || []);

      return results.map(result => result.filePath);
    } catch (error) {
      this.log('Warning: Failed to find sibling modules via hybrid search');
      return [];
    }
  }

  /**
   * Extracts module signatures (exported symbols only)
   */
  private async extractModuleSignatures(
    filePath: string
  ): Promise<ASTContextNode[]> {
    const signatures: ASTContextNode[] = [];

    try {
      const exports = await (this.astGraph as any).getExports(filePath);

      for (const exp of exports) {
        try {
          const node = await (this.astGraph as any).getSymbol(filePath, exp.name);
          if (node) {
            // Extract only signature, not full implementation
            const signatureNode = this.extractSignatureOnly(node);
            signatures.push(
              this.convertToASTContextNode(signatureNode, filePath, 60)
            );
          }
        } catch (error) {
          // Skip failed symbol extraction
        }
      }
    } catch (error) {
      this.log(`Warning: Failed to extract module signatures from ${filePath}`);
    }

    return signatures;
  }

  /**
   * Extracts signature from AST node (removes implementation)
   */
  private extractSignatureOnly(node: ASTNode): ASTNode {
    return {
      ...node,
      text: this.extractDeclarationOnly(node.text ?? ''),
      body: undefined,
    };
  }

  /**
   * Extracts declaration only from source code
   */
  private extractDeclarationOnly(sourceCode: string): string {
    // For functions and methods: extract everything before opening brace
    const functionMatch = sourceCode.match(/^([^{]+)\{/);
    if (functionMatch) {
      return functionMatch[1].trim();
    }

    // For other declarations: extract everything before semicolon or opening brace
    const declarationMatch = sourceCode.match(/^([^{;]+)[{;]/);
    if (declarationMatch) {
      return declarationMatch[1].trim();
    }

    return sourceCode;
  }

  /**
   * Prioritizes symbols in AST nodes (mutates array order)
   */
  private prioritizeSymbols(
    nodes: ASTContextNode[],
    prioritySymbols: ReadonlyArray<string>
  ): void {
    const prioritySet = new Set(prioritySymbols.map(s => s.toLowerCase()));

    // Boost relevance for priority symbols
    for (const node of nodes) {
      if (prioritySet.has(node.name.toLowerCase())) {
        (node as { relevanceScore: number }).relevanceScore = Math.min(
          100,
          node.relevanceScore + 20
        );
      }
    }
  }

  /**
   * Parses stack trace to extract file paths in order
   */
  private parseStackTrace(stackTrace: string): string[] {
    const filePaths: string[] = [];
    const lines = stackTrace.split('\n');

    for (const line of lines) {
      // Match common stack trace formats:
      // - at functionName (file.ts:line:col)
      // - at file.ts:line:col
      // - file.ts:line:col
      const match = line.match(
        /(?:at\s+(?:.*?\s+)?\(?)?([^:()]+\.[jt]sx?):(\d+):(\d+)/
      );
      
      if (match) {
        const filePath = match[1].trim();
        if (!filePaths.includes(filePath)) {
          filePaths.push(filePath);
        }
      }
    }

    return filePaths;
  }

  /**
   * Traces dependencies through call stack
   */
  private async traceDependenciesThroughCallStack(
    callStack: ReadonlyArray<string>
  ): Promise<ModuleDependencyInfo[]> {
    const dependencies: ModuleDependencyInfo[] = [];

    for (let i = 0; i < callStack.length - 1; i++) {
      const source = callStack[i];
      const target = callStack[i + 1];

      try {
        const deps = await (this.astGraph as any).getDependenciesBetween(source, target);
        dependencies.push(
          ...deps.map(dep => this.convertToDependencyInfo(dep))
        );
      } catch (error) {
        this.log(`Warning: Failed to trace dependencies ${source} -> ${target}`);
      }
    }

    return dependencies;
  }

  /**
   * Weaves error context using Context Weaver
   */
  private async weaveErrorContext(
    errorMessage: string,
    stackTrace: string
  ): Promise<ASTContextNode[]> {
    try {
      const errorContext = await (this.contextWeaver as any).weaveErrorContext({
        errorMessage,
        stackTrace,
        maxNodes: 10,
      });

      return errorContext.map(ctx =>
        this.convertToASTContextNode(ctx.astNode, ctx.filePath, 95) // Very high relevance
      );
    } catch (error) {
      this.log('Warning: Context weaver failed to weave error context');
      return [];
    }
  }

  /**
   * Assembles final context payload
   */
  private assembleContextPayload(
    task: AgentTaskDescriptor,
    context: RawContextData,
    stats: ContextRetrievalStats,
    durationMs: number
  ): AgentContextPayload {
    return {
      task,
      fileContents: context.fileContents,
      astContext: context.astNodes,
      dependencies: context.dependencies,
      diffs: context.diffs.length > 0 ? context.diffs : undefined,
      estimatedTokens: stats.tokenBudgetUsed,
      wasPruned: stats.prunedNodes > 0,
      pruningStats: stats.prunedNodes > 0 ? {
        totalNodes: stats.totalNodes,
        includedNodes: stats.totalNodes - stats.prunedNodes,
        prunedNodes: stats.prunedNodes,
      } : undefined,
      metadata: {
        retrievalTimestamp: Date.now(),
        retrievalDurationMs: durationMs,
        indexerVersion: this.config.indexerVersion,
        contextStrategy: this.getContextStrategyName(task.role),
      },
    };
  }

  /**
   * Gets context strategy name for role
   */
  private getContextStrategyName(role: AgentRole): string {
    const strategies: Record<AgentRole, string> = {
      'ARCHITECT': 'topology-first-dependency-tree',
      'CODER': 'symbol-precise-type-aware',
      'DEBUGGER': 'trace-dfs-diff-analysis',
    };

    return strategies[role];
  }

  /* ===========================
   * Validation & Utilities
   * =========================== */

  /**
   * Validates task descriptor
   * @throws {Error} If validation fails
   */
  private validateTask(task: AgentTaskDescriptor): void {
    if (!task.taskPrompt || task.taskPrompt.trim().length === 0) {
      throw new Error('Task prompt cannot be empty');
    }

    if (!task.targetedFiles || task.targetedFiles.length === 0) {
      throw new Error('At least one targeted file must be specified');
    }

    const validRoles: ReadonlyArray<AgentRole> = ['ARCHITECT', 'CODER', 'DEBUGGER'];
    if (!validRoles.includes(task.role)) {
      throw new Error(
        `Invalid agent role: ${task.role}. Must be one of: ${validRoles.join(', ')}`
      );
    }

    // Validate file paths are non-empty strings
    for (const file of task.targetedFiles) {
      if (typeof file !== 'string' || file.trim().length === 0) {
        throw new Error('All targeted files must be non-empty strings');
      }
    }
  }

  /**
   * Validates token budget
   * @throws {Error} If validation fails
   */
  private validateTokenBudget(maxTokenBudget: number): void {
    if (!Number.isInteger(maxTokenBudget) || maxTokenBudget <= 0) {
      throw new Error('Token budget must be a positive integer');
    }

    if (maxTokenBudget < 100) {
      throw new Error('Token budget must be at least 100 tokens');
    }

    if (maxTokenBudget > 1000000) {
      throw new Error('Token budget exceeds maximum limit of 1,000,000 tokens');
    }
  }

  /**
   * Logs message if logging is enabled
   */
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[SwarmContextBridge] ${message}`);
    }
  }

  /**
   * Safely extracts error message from unknown error type
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
 * Factory Functions
 * =========================== */

/**
 * Factory function to create SwarmContextBridge instance
 * 
 * @param merkleDAG - Merkle DAG instance
 * @param astGraph - AST Graph instance
 * @param contextWeaver - Context Weaver instance
 * @param hybridSearch - Hybrid Search instance
 * @param config - Optional configuration
 * @returns SwarmContextBridge instance
 * 
 * @example
 * ```typescript
 * const bridge = createSwarmContextBridge(
 *   merkleDAG,
 *   astGraph,
 *   contextWeaver,
 *   hybridSearch,
 *   { enableLogging: true }
 * );
 * ```
 */
export function createSwarmContextBridge(
  merkleDAG: MerkleDAG,
  astGraph: ASTGraph,
  contextWeaver: ContextWeaver,
  hybridSearch: HybridSearch,
  config?: SwarmContextBridgeConfig
): ISwarmContextBridge {
  return new SwarmContextBridge(
    merkleDAG,
    astGraph,
    contextWeaver,
    hybridSearch,
    config
  );
}

/**
 * Default export
 */
export default SwarmContextBridge;
