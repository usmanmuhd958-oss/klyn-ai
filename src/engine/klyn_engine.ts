// src/engine/klyn_engine.ts
import type { IndexStats } from '../types/core.js';
import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';
import { RepositoryIndexer } from '../indexer/repository_indexer.js';
import { QueryEngine } from '../query/query_engine.js';
import type { ScanOptions } from '../indexer/file_scanner.js';

export class KlynEngine {
  private dag: MerkleDAGEngine;
  private depGraph: DependencyGraphBuilder;
  private indexer: RepositoryIndexer;
  private query: QueryEngine;
  
  constructor() {
    this.dag = new MerkleDAGEngine();
    this.depGraph = new DependencyGraphBuilder();
    this.indexer = new RepositoryIndexer(this.dag, this.depGraph);
    this.query = new QueryEngine(this.dag, this.depGraph);
  }
  
  async indexRepository(rootPath: string, options?: ScanOptions): Promise<IndexStats> {
    return this.indexer.index(rootPath, options);
  }
  
  getQueryEngine(): QueryEngine {
    return this.query;
  }
  
  getDAG(): MerkleDAGEngine {
    return this.dag;
  }
  
  getDependencyGraph(): DependencyGraphBuilder {
    return this.depGraph;
  }
  
  getStats() {
    return {
      dagNodes: this.dag.size(),
      graphNodes: this.depGraph.size(),
    };
  }
  
  clear(): void {
    this.dag.clear();
    this.depGraph.clear();
  }
}
