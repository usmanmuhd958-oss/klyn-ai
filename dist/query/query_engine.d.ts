import type { MerkleNode, GraphNode } from '../types/core.js';
import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';
export interface QueryResult {
    node: MerkleNode;
    graphNode?: GraphNode;
    score: number;
}
export declare class QueryEngine {
    private dag;
    private depGraph;
    constructor(dag: MerkleDAGEngine, depGraph: DependencyGraphBuilder);
    findByPath(path: string): QueryResult | null;
    findByHash(hash: string): QueryResult | null;
    findByContent(pattern: string): QueryResult[];
    findDependencies(path: string, depth?: number): Set<string>;
    findDependents(path: string, depth?: number): Set<string>;
    getImpactAnalysis(path: string): {
        directDependents: number;
        totalDependents: number;
        affectedFiles: string[];
    };
}
//# sourceMappingURL=query_engine.d.ts.map