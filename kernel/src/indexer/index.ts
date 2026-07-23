// kernel/src/indexer/index.ts

import { EventEmitter } from 'node:events';
import MerkleDAG, { type MerkleDAGConfig } from './merkle_dag';
import ASTGraph, { type ASTGraphConfig } from './ast_graph';
import HybridSearch, { type HybridSearchConfig } from './hybrid_search';
import ContextWeaver, { type WeaverConfig, type ContextRequest, type CodeContext } from './context_weaver';

/**
 * KLYN AI OS - Unified Codebase Engine
 * Ultra-high-performance code indexing and search
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface KlynEngineConfig {
  rootPath: string;
  merkleDAG?: Partial<MerkleDAGConfig>;
  astGraph?: Partial<ASTGraphConfig>;
  hybridSearch?: Partial<HybridSearchConfig>;
  contextWeaver?: Partial<WeaverConfig>;
  autoIndex?: boolean;
  watchMode?: boolean;
}

export interface EngineStats {
  merkle: {
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    lastSync: number;
  };
  ast: {
    totalFiles: number;
    totalSymbols: number;
    totalDependencies: number;
  };
  performance: {
    indexTime: number;
    averageSearchTime: number;
    averageContextTime: number;
  };
}

// ============================================================================
// KLYN Codebase Engine
// ============================================================================

export class KlynCodebaseEngine extends EventEmitter {
  private config: KlynEngineConfig;
  private merkleDAG: MerkleDAG;
  private astGraph: ASTGraph;
  private hybridSearch: HybridSearch;
  private contextWeaver: ContextWeaver;
  private isIndexed: boolean = false;

  constructor(config: KlynEngineConfig) {
    super();

    this.config = config;

    // Initialize components
    this.merkleDAG = new MerkleDAG({
      rootPath: config.rootPath,
      ...config.merkleDAG,
    });

    this.astGraph = new ASTGraph(config.astGraph);

    this.hybridSearch = new HybridSearch(
      this.merkleDAG,
      this.astGraph,
      config.hybridSearch
    );

    this.contextWeaver = new ContextWeaver(
      this.merkleDAG,
      this.astGraph,
      this.hybridSearch,
      config.contextWeaver
    );

    this.setupEventForwarding();

    if (config.autoIndex) {
      this.initialize().catch(error => {
        this.emit('error', error);
      });
    }
  }

  private setupEventForwarding(): void {
    // Forward events from components
    this.merkleDAG.on('index:complete', (snapshot) => {
      this.emit('merkle:indexed', snapshot);
    });

    this.astGraph.on('parse:complete', (file, time) => {
      this.emit('ast:parsed', file, time);
    });

    this.hybridSearch.on('search:complete', (query, stats) => {
      this.emit('search:complete', query, stats);
    });

    this.contextWeaver.on('weave:complete', (context) => {
      this.emit('context:woven', context);
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  public async initialize(): Promise<void> {
    const startTime = performance.now();

    this.emit('engine:init:start');

    try {
      // Step 1: Build Merkle DAG
      this.emit('engine:merkle:start');
      await this.merkleDAG.buildIndex();
      this.emit('engine:merkle:complete');

      // Step 2: Parse AST for all TypeScript/JavaScript files
      this.emit('engine:ast:start');
      await this.parseAllFiles();
      this.emit('engine:ast:complete');

      this.isIndexed = true;

      const initTime = performance.now() - startTime;

      this.emit('engine:init:complete', {
        duration: initTime,
        stats: this.getStats(),
      });
    } catch (error) {
      this.emit('engine:init:error', error);
      throw error;
    }
  }

  private async parseAllFiles(): Promise<void> {
    const files = this.merkleDAG.getFilesByPattern(/\.(ts|tsx|js|jsx)$/);

    const parsePromises = files.map(node =>
      this.astGraph.parseFile(node.path).catch(error => {
        // Log but don't fail on individual file errors
        this.emit('parse:error', node.path, error);
      })
    );

    await Promise.all(parsePromises);
  }

  // ============================================================================
  // Public API
  // ============================================================================

  public async search(pattern: string, options: {
    caseSensitive?: boolean;
    regex?: boolean;
    maxResults?: number;
  } = {}) {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.hybridSearch.search({
      pattern,
      ...options,
    });
  }

  public async searchSymbol(symbolName: string, options: {
    exported?: boolean;
    kind?: string;
  } = {}) {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.hybridSearch.searchSymbol(symbolName, options);
  }

  public async findReferences(symbolName: string, filePath: string) {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.hybridSearch.findReferences(symbolName, filePath);
  }

  public async findDefinition(symbolName: string, fromFile: string) {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.hybridSearch.findDefinition(symbolName, fromFile);
  }

  public async weaveContext(request: ContextRequest): Promise<CodeContext> {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.contextWeaver.weaveContext(request);
  }

  public async weaveBugFixContext(
    errorMessage: string,
    stackTrace: string,
    filePath?: string
  ): Promise<CodeContext> {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.contextWeaver.weaveBugFixContext(errorMessage, stackTrace, filePath);
  }

  public async weaveRefactoringContext(
    targetFile: string,
    targetSymbol?: string
  ): Promise<CodeContext> {
    if (!this.isIndexed) {
      throw new Error('Engine not indexed. Call initialize() first.');
    }

    return this.contextWeaver.weaveRefactoringContext(targetFile, targetSymbol);
  }

  public async updateFile(filePath: string): Promise<void> {
    // Update Merkle DAG
    await this.merkleDAG.updatePath(filePath);

    // Re-parse AST
    if (/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      await this.astGraph.parseFile(filePath);
    }

    this.emit('file:updated', filePath);
  }

  public getDependencies(filePath: string, depth: number = 1): Set<string> {
    return this.astGraph.getDependencies(filePath, depth);
  }

  public getDependents(filePath: string, depth: number = 1): Set<string> {
    return this.astGraph.getDependents(filePath, depth);
  }

  public getFileSymbols(filePath: string) {
    return this.astGraph.findSymbolsInFile(filePath);
  }

  public getStats(): EngineStats {
    const merkleStats = this.merkleDAG.getStats();
    const astStats = this.astGraph.getStats();

    return {
      merkle: {
        totalFiles: merkleStats.totalFiles,
        totalDirectories: merkleStats.totalDirectories,
        totalSize: merkleStats.totalSize,
        lastSync: merkleStats.lastSync,
      },
      ast: astStats,
      performance: {
        indexTime: merkleStats.indexTime,
        averageSearchTime: 0, // Would track this with metrics
        averageContextTime: 0, // Would track this with metrics
      },
    };
  }

  public clear(): void {
    this.merkleDAG.clear();
    this.astGraph.clear();
    this.isIndexed = false;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  MerkleDAG,
  ASTGraph,
  HybridSearch,
  ContextWeaver,
};

export type {
  MerkleDAGConfig,
  ASTGraphConfig,
  HybridSearchConfig,
  WeaverConfig,
  ContextRequest,
  CodeContext,
};

export default KlynCodebaseEngine;
