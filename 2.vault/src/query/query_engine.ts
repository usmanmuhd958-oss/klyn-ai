// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// src/query/query_engine.ts
import type { MerkleNode, GraphNode } from '../types/core.js';
import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';

export interface QueryResult {
  node: MerkleNode;
  graphNode?: GraphNode;
  score: number;
}

export class QueryEngine {
  constructor(
    private dag: MerkleDAGEngine,
    private depGraph: DependencyGraphBuilder
  ) {}
  
  findByPath(path: string): QueryResult | null {
    const node = this.dag.getByPath(path);
    if (!node) return null;
    
    const graphNode = this.depGraph.getNode(path);
    
    return {
      node,
      graphNode,
      score: 1.0,
    };
  }
  
  findByHash(hash: string): QueryResult | null {
    const node = this.dag.get(hash);
    if (!node) return null;
    
    const graphNode = this.depGraph.getNode(node.metadata.path);
    
    return {
      node,
      graphNode,
      score: 1.0,
    };
  }
  
  findByContent(pattern: string): QueryResult[] {
    const results: QueryResult[] = [];
    const regex = new RegExp(pattern, 'i');
    
    for (const hash of this.dag.getAllHashes()) {
      const node = this.dag.get(hash)!;
      const content = Buffer.from(node.data).toString('utf-8');
      
      if (regex.test(content)) {
        const graphNode = this.depGraph.getNode(node.metadata.path);
        const matches = content.match(new RegExp(pattern, 'gi'))?.length || 0;
        const score = matches / content.length;
        
        results.push({ node, graphNode, score });
      }
    }
    
    return results.sort((a, b) => b.score - a.score);
  }
  
  findDependencies(path: string, depth: number = 1): Set<string> {
    const visited = new Set<string>();
    
    const traverse = (currentPath: string, currentDepth: number) => {
      if (currentDepth > depth || visited.has(currentPath)) return;
      
      visited.add(currentPath);
      const deps = this.depGraph.getDependencies(currentPath);
      
      for (const dep of deps) {
        traverse(dep, currentDepth + 1);
      }
    };
    
    traverse(path, 0);
    visited.delete(path);
    
    return visited;
  }
  
  findDependents(path: string, depth: number = 1): Set<string> {
    const visited = new Set<string>();
    
    const traverse = (currentPath: string, currentDepth: number) => {
      if (currentDepth > depth || visited.has(currentPath)) return;
      
      visited.add(currentPath);
      const dependents = this.depGraph.getDependents(currentPath);
      
      for (const dependent of dependents) {
        traverse(dependent, currentDepth + 1);
      }
    };
    
    traverse(path, 0);
    visited.delete(path);
    
    return visited;
  }
  
  getImpactAnalysis(path: string): {
    directDependents: number;
    totalDependents: number;
    affectedFiles: string[];
  } {
    const directDependents = this.depGraph.getDependents(path);
    const allDependents = this.findDependents(path, 999);
    
    return {
      directDependents: directDependents.length,
      totalDependents: allDependents.size,
      affectedFiles: Array.from(allDependents),
    };
  }
}
