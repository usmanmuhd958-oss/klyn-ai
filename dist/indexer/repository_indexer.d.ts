import type { IndexStats } from '../types/core.js';
import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';
import { type ScanOptions } from './file_scanner.js';
export declare class RepositoryIndexer {
    private dag;
    private depGraph;
    constructor(dag: MerkleDAGEngine, depGraph: DependencyGraphBuilder);
    index(rootPath: string, options?: ScanOptions): Promise<IndexStats>;
    private resolveImport;
    private normalizePath;
}
//# sourceMappingURL=repository_indexer.d.ts.map