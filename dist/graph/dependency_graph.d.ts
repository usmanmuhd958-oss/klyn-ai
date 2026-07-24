import type { DependencyGraph, GraphNode } from '../types/core.js';
export declare class DependencyGraphBuilder {
    private graph;
    addFile(path: string, content: string): string;
    getDependencies(path: string): string[];
    getDependents(path: string): string[];
    getNode(path: string): GraphNode | undefined;
    hasCircularDependency(path: string): boolean;
    topologicalSort(): string[];
    getGraph(): DependencyGraph;
    clear(): void;
    size(): number;
}
//# sourceMappingURL=dependency_graph.d.ts.map