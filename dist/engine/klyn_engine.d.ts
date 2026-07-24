import type { IndexStats } from '../types/core.js';
import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';
import { QueryEngine } from '../query/query_engine.js';
import type { ScanOptions } from '../indexer/file_scanner.js';
export declare class KlynEngine {
    private dag;
    private depGraph;
    private indexer;
    private query;
    constructor();
    indexRepository(rootPath: string, options?: ScanOptions): Promise<IndexStats>;
    getQueryEngine(): QueryEngine;
    getDAG(): MerkleDAGEngine;
    getDependencyGraph(): DependencyGraphBuilder;
    getStats(): {
        dagNodes: number;
        graphNodes: number;
    };
    clear(): void;
}
//# sourceMappingURL=klyn_engine.d.ts.map