// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// src/graph/dependency_graph.ts
import type { DependencyGraph, GraphNode, ASTNode } from '../types/core.js';
import { ASTParser } from '../parser/ast_parser.js';
import { LanguageDetector } from '../parser/language_detector.js';
import { HashEngine } from '../core/hash.js';

export class DependencyGraphBuilder {
  private graph: DependencyGraph = {
    nodes: new Map(),
    edges: new Map(),
  };
  
  addFile(path: string, content: string): string {
    const language = LanguageDetector.detect(path);
    const hash = HashEngine.hash(content);
    
    const astNodes: ASTNode[] = language 
      ? ASTParser.parse(content, language, path)
      : [];
    
    const imports = astNodes.flatMap(n => n.dependencies);
    const exports = astNodes.flatMap(n => n.exports);
    
    const node: GraphNode = {
      path,
      hash,
      imports,
      exports,
      astNodes,
    };
    
    this.graph.nodes.set(path, node);
    this.graph.edges.set(path, new Set(imports));
    
    return hash;
  }
  
  getDependencies(path: string): string[] {
    return Array.from(this.graph.edges.get(path) || []);
  }
  
  getDependents(path: string): string[] {
    const dependents: string[] = [];
    
    for (const [nodePath, deps] of this.graph.edges.entries()) {
      if (deps.has(path)) {
        dependents.push(nodePath);
      }
    }
    
    return dependents;
  }
  
  getNode(path: string): GraphNode | undefined {
    return this.graph.nodes.get(path);
  }
  
  hasCircularDependency(path: string): boolean {
    const visited = new Set<string>();
    const stack = new Set<string>();
    
    const dfs = (current: string): boolean => {
      if (stack.has(current)) return true;
      if (visited.has(current)) return false;
      
      visited.add(current);
      stack.add(current);
      
      const deps = this.graph.edges.get(current) || new Set();
      for (const dep of deps) {
        if (dfs(dep)) return true;
      }
      
      stack.delete(current);
      return false;
    };
    
    return dfs(path);
  }
  
  topologicalSort(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    
    const dfs = (node: string) => {
      if (visited.has(node)) return;
      visited.add(node);
      
      const deps = this.graph.edges.get(node) || new Set();
      for (const dep of deps) {
        if (this.graph.nodes.has(dep)) {
          dfs(dep);
        }
      }
      
      result.push(node);
    };
    
    for (const node of this.graph.nodes.keys()) {
      dfs(node);
    }
    
    return result.reverse();
  }
  
  getGraph(): DependencyGraph {
    return this.graph;
  }
  
  clear(): void {
    this.graph.nodes.clear();
    this.graph.edges.clear();
  }
  
  size(): number {
    return this.graph.nodes.size;
  }
}
