// kernel/src/ast/dependency_graph.ts

import { dirname, join, resolve } from 'node:path';

/**
 * Represents a parsed file node with dependency metadata
 */
interface DependencyNode {
  path: string;
  imports: Set<string>;
  exports: Set<string>;
  symbols: Set<string>;
  content: string;
}

/**
 * High-performance AST Dependency Graph for TypeScript/JavaScript
 * Uses regex-based tokenization for ultra-lightweight parsing
 */
export class ASTDependencyGraph {
  private readonly nodes: Map<string, DependencyNode>;
  private readonly dependencyEdges: Map<string, Set<string>>;
  private readonly reverseDependencyEdges: Map<string, Set<string>>;
  private readonly maxDepth: number = 1000;

  constructor() {
    this.nodes = new Map();
    this.dependencyEdges = new Map();
    this.reverseDependencyEdges = new Map();
  }

  /**
   * Adds a file to the dependency graph with full AST analysis
   */
  public addFile(path: string, content: string): void {
    const normalizedPath = this.normalizePath(path);

    const node: DependencyNode = {
      path: normalizedPath,
      imports: new Set(),
      exports: new Set(),
      symbols: new Set(),
      content
    };

    this.parseImports(content, node);
    this.parseExports(content, node);
    this.parseSymbols(content, node);

    this.nodes.set(normalizedPath, node);

    if (!this.dependencyEdges.has(normalizedPath)) {
      this.dependencyEdges.set(normalizedPath, new Set());
    }

    for (const importPath of node.imports) {
      const resolvedImport = this.resolveImportPath(normalizedPath, importPath);
      this.dependencyEdges.get(normalizedPath)!.add(resolvedImport);

      if (!this.reverseDependencyEdges.has(resolvedImport)) {
        this.reverseDependencyEdges.set(resolvedImport, new Set());
      }
      this.reverseDependencyEdges.get(resolvedImport)!.add(normalizedPath);
    }
  }

  /**
   * Gets all direct dependencies of a file
   */
  public getDependencies(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    const deps = this.dependencyEdges.get(normalizedPath);
    return deps ? Array.from(deps) : [];
  }

  /**
   * Gets all files that depend on this file (reverse lookup)
   */
  public getDependents(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    const dependents = this.reverseDependencyEdges.get(normalizedPath);
    return dependents ? Array.from(dependents) : [];
  }

  /**
   * Computes topological ordering starting from entry point
   * @throws {Error} if circular dependency detected
   */
  public getTopologicalOrder(entryPath: string): string[] {
    const normalizedEntry = this.normalizePath(entryPath);
    const visited = new Set<string>();
    const result: string[] = [];
    const visiting = new Set<string>();

    const visit = (path: string, depth: number): void => {
      if (depth > this.maxDepth) {
        throw new Error(`Maximum dependency depth ${this.maxDepth} exceeded at ${path}`);
      }

      if (visited.has(path)) {
        return;
      }

      if (visiting.has(path)) {
        throw new Error(`Circular dependency detected: ${path} is part of a cycle`);
      }

      visiting.add(path);

      const dependencies = this.dependencyEdges.get(path);
      if (dependencies) {
        for (const dep of dependencies) {
          visit(dep, depth + 1);
        }
      }

      visiting.delete(path);
      visited.add(path);
      result.push(path);
    };

    visit(normalizedEntry, 0);
    return result;
  }

  /**
   * Extracts import statements using high-speed regex tokenization
   */
  private parseImports(content: string, node: DependencyNode): void {
    const cleanedContent = this.removeCommentsAndStrings(content);

    // ES6 static imports: import ... from 'path'
    const importRegex = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    
    while ((match = importRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.imports.add(match[1]);
      }
    }

    // Dynamic imports: import('path')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.imports.add(match[1]);
      }
    }

    // CommonJS require: require('path')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.imports.add(match[1]);
      }
    }

    // Re-exports: export ... from 'path'
    const exportFromRegex = /export\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = exportFromRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.imports.add(match[1]);
      }
    }
  }

  /**
   * Extracts export declarations
   */
  private parseExports(content: string, node: DependencyNode): void {
    const cleanedContent = this.removeCommentsAndStrings(content);

    // Named exports: export const/let/var/function/class/interface/type/enum name
    const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    
    while ((match = namedExportRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.exports.add(match[1]);
      }
    }

    // Export blocks: export { name1, name2 as alias }
    const exportBlockRegex = /export\s*\{([^}]+)\}/g;
    while ((match = exportBlockRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        const exports = match[1]
          .split(',')
          .map(e => e.trim().split(/\s+as\s+/)[0].trim())
          .filter(e => e.length > 0);
        exports.forEach(e => node.exports.add(e));
      }
    }

    // Default export
    if (/export\s+default\s+/.test(cleanedContent)) {
      node.exports.add('default');
    }

    // Export all: export *
    if (/export\s+\*/.test(cleanedContent)) {
      node.exports.add('*');
    }
  }

  /**
   * Extracts symbols (functions, classes, types, interfaces)
   */
  private parseSymbols(content: string, node: DependencyNode): void {
    const cleanedContent = this.removeCommentsAndStrings(content);

    // Function declarations and arrow functions
    const functionRegex = /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|=\s*async\s+\(|:\s*\(|\()/g;
    let match: RegExpExecArray | null;
    
    while ((match = functionRegex.exec(cleanedContent)) !== null) {
      if (match[1] && match[1] !== 'function') {
        node.symbols.add(match[1]);
      }
    }

    // Class declarations
    const classRegex = /class\s+(\w+)/g;
    while ((match = classRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.symbols.add(match[1]);
      }
    }

    // Interface/Type/Enum declarations
    const typeRegex = /(?:interface|type|enum)\s+(\w+)/g;
    while ((match = typeRegex.exec(cleanedContent)) !== null) {
      if (match[1]) {
        node.symbols.add(match[1]);
      }
    }
  }

  /**
   * Removes comments and string literals to prevent false positives
   */
  private removeCommentsAndStrings(content: string): string {
    let result = content;
    
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, ' ');
    
    // Remove single-line comments
    result = result.replace(/\/\/.*/g, ' ');
    
    // Remove template literals (preserving structure)
    result = result.replace(/`(?:[^`\\]|\\.)*`/g, '""');
    
    // Remove string literals
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, '""');
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    
    return result;
  }

  /**
   * Normalizes file paths for cross-platform compatibility
   */
  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  /**
   * Resolves import path relative to importing file
   */
  private resolveImportPath(fromPath: string, importPath: string): string {
    // Skip node_modules and built-in modules
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return importPath;
    }

    // Handle relative imports
    const dir = dirname(fromPath);
    let resolved = this.normalizePath(join(dir, importPath));

    // Add extension if missing
    if (!resolved.match(/\.(ts|js|tsx|jsx|mts|cts|mjs|cjs)$/)) {
      // Try common extensions
      const extensions = ['.ts', '.js', '.tsx', '.jsx', '.mts', '.cts'];
      for (const ext of extensions) {
        const candidate = resolved + ext;
        if (this.nodes.has(candidate)) {
          return candidate;
        }
      }
      // Default to .ts
      resolved = resolved + '.ts';
    }

    return resolved;
  }

  /**
   * Gets node metadata for a file
   */
  public getNode(path: string): DependencyNode | undefined {
    return this.nodes.get(this.normalizePath(path));
  }

  /**
   * Gets all registered nodes
   */
  public getAllNodes(): DependencyNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Gets all transitive dependencies up to maxDepth
   */
  public getTransitiveDependencies(path: string, maxDepth: number = Infinity): Set<string> {
    const normalizedPath = this.normalizePath(path);
    const result = new Set<string>();
    const visited = new Set<string>();

    const traverse = (currentPath: string, depth: number): void => {
      if (depth > maxDepth || visited.has(currentPath)) {
        return;
      }

      visited.add(currentPath);
      
      if (currentPath !== normalizedPath) {
        result.add(currentPath);
      }

      const deps = this.dependencyEdges.get(currentPath);
      if (deps) {
        for (const dep of deps) {
          traverse(dep, depth + 1);
        }
      }
    };

    traverse(normalizedPath, 0);
    return result;
  }

  /**
   * Gets all transitive dependents (files that depend on this) up to maxDepth
   */
  public getTransitiveDependents(path: string, maxDepth: number = Infinity): Set<string> {
    const normalizedPath = this.normalizePath(path);
    const result = new Set<string>();
    const visited = new Set<string>();

    const traverse = (currentPath: string, depth: number): void => {
      if (depth > maxDepth || visited.has(currentPath)) {
        return;
      }

      visited.add(currentPath);
      
      if (currentPath !== normalizedPath) {
        result.add(currentPath);
      }

      const dependents = this.reverseDependencyEdges.get(currentPath);
      if (dependents) {
        for (const dependent of dependents) {
          traverse(dependent, depth + 1);
        }
      }
    };

    traverse(normalizedPath, 0);
    return result;
  }

  /**
   * Clears all data from the graph
   */
  public clear(): void {
    this.nodes.clear();
    this.dependencyEdges.clear();
    this.reverseDependencyEdges.clear();
  }

  /**
   * Gets graph statistics
   */
  public getStats(): { nodeCount: number; edgeCount: number; avgDependencies: number } {
    let edgeCount = 0;
    for (const deps of this.dependencyEdges.values()) {
      edgeCount += deps.size;
    }

    const nodeCount = this.nodes.size;
    const avgDependencies = nodeCount > 0 ? edgeCount / nodeCount : 0;

    return { nodeCount, edgeCount, avgDependencies };
  }
}
