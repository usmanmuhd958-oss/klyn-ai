// kernel/src/ast/dependency_graph.ts
import type { DAGNode } from '../pipeline/repo_ingest.js';
import { join, dirname, resolve, extname, sep } from 'node:path';

export interface SymbolImport {
  symbol: string;
  alias?: string;
  source: string;
  line: number;
  isDefault: boolean;
  isNamespace: boolean;
  isDynamic: boolean;
}

export interface SymbolExport {
  symbol: string;
  line: number;
  isDefault: boolean;
  reExportFrom?: string;
}

export interface FileNode {
  path: string;
  hash: string;
  language: string;
  imports: SymbolImport[];
  exports: SymbolExport[];
  directDependencies: Set<string>;
  directDependents: Set<string>;
  symbolMap: Map<string, string[]>;
}

export interface CircularChain {
  files: string[];
  symbols: string[];
}

export class ASTDependencyGraph {
  private nodes: Map<string, FileNode> = new Map();
  private pathResolver: PathResolver = new PathResolver();
  private rootPath: string = '';

  async buildFromDAG(dagRoot: DAGNode): Promise<void> {
    this.nodes.clear();
    this.rootPath = dagRoot.path;
    
    const fileNodes: Array<{ path: string; content: string; language: string; hash: string }> = [];
    
    this.collectFiles(dagRoot, fileNodes);
    
    for (const { path, content, language, hash } of fileNodes) {
      const imports = this.parseImports(content, language);
      const exports = this.parseExports(content, language);
      
      const node: FileNode = {
        path,
        hash,
        language,
        imports,
        exports,
        directDependencies: new Set(),
        directDependents: new Set(),
        symbolMap: new Map(),
      };
      
      this.nodes.set(path, node);
    }
    
    this.resolveAllDependencies();
    this.buildSymbolMaps();
  }

  getDirectDependencies(filePath: string): string[] {
    const node = this.nodes.get(filePath);
    if (!node) return [];
    return Array.from(node.directDependencies);
  }

  getAffectedFilesOnMutation(filePath: string): string[] {
    const affected = new Set<string>();
    const visited = new Set<string>();
    
    const traverse = (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);
      
      const node = this.nodes.get(path);
      if (!node) return;
      
      for (const dependent of node.directDependents) {
        affected.add(dependent);
        traverse(dependent);
      }
    };
    
    traverse(filePath);
    
    return Array.from(affected).sort();
  }

  findCircularImports(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];
    
    const dfs = (filePath: string): boolean => {
      if (recursionStack.has(filePath)) {
        const cycleStart = currentPath.indexOf(filePath);
        if (cycleStart !== -1) {
          cycles.push([...currentPath.slice(cycleStart), filePath]);
        }
        return true;
      }
      
      if (visited.has(filePath)) return false;
      
      visited.add(filePath);
      recursionStack.add(filePath);
      currentPath.push(filePath);
      
      const node = this.nodes.get(filePath);
      if (node) {
        for (const dep of node.directDependencies) {
          dfs(dep);
        }
      }
      
      currentPath.pop();
      recursionStack.delete(filePath);
      
      return false;
    };
    
    for (const filePath of this.nodes.keys()) {
      if (!visited.has(filePath)) {
        dfs(filePath);
      }
    }
    
    return this.deduplicateCycles(cycles);
  }

  getAllDependencies(filePath: string, maxDepth: number = Infinity): Set<string> {
    const dependencies = new Set<string>();
    const visited = new Set<string>();
    
    const traverse = (path: string, depth: number) => {
      if (depth > maxDepth || visited.has(path)) return;
      visited.add(path);
      
      const node = this.nodes.get(path);
      if (!node) return;
      
      for (const dep of node.directDependencies) {
        dependencies.add(dep);
        traverse(dep, depth + 1);
      }
    };
    
    traverse(filePath, 0);
    return dependencies;
  }

  getAllDependents(filePath: string, maxDepth: number = Infinity): Set<string> {
    const dependents = new Set<string>();
    const visited = new Set<string>();
    
    const traverse = (path: string, depth: number) => {
      if (depth > maxDepth || visited.has(path)) return;
      visited.add(path);
      
      const node = this.nodes.get(path);
      if (!node) return;
      
      for (const dependent of node.directDependents) {
        dependents.add(dependent);
        traverse(dependent, depth + 1);
      }
    };
    
    traverse(filePath, 0);
    return dependents;
  }

  getSymbolProviders(symbol: string): string[] {
    const providers: string[] = [];
    
    for (const [path, node] of this.nodes.entries()) {
      const hasExport = node.exports.some(exp => 
        exp.symbol === symbol || exp.symbol === 'default'
      );
      
      if (hasExport) {
        providers.push(path);
      }
    }
    
    return providers;
  }

  getSymbolConsumers(filePath: string, symbol: string): string[] {
    const consumers: string[] = [];
    
    for (const [path, node] of this.nodes.entries()) {
      for (const imp of node.imports) {
        const resolvedSource = this.pathResolver.resolve(imp.source, dirname(path), this.getAllPaths());
        
        if (resolvedSource === filePath) {
          if (imp.symbol === symbol || imp.isNamespace || imp.isDefault) {
            consumers.push(path);
            break;
          }
        }
      }
    }
    
    return consumers;
  }

  getFileNode(filePath: string): FileNode | undefined {
    return this.nodes.get(filePath);
  }

  topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();
    
    const visit = (path: string): boolean => {
      if (temp.has(path)) return false;
      if (visited.has(path)) return true;
      
      temp.add(path);
      
      const node = this.nodes.get(path);
      if (node) {
        for (const dep of node.directDependencies) {
          if (!visit(dep)) return false;
        }
      }
      
      temp.delete(path);
      visited.add(path);
      result.push(path);
      
      return true;
    };
    
    for (const path of this.nodes.keys()) {
      if (!visited.has(path)) {
        if (!visit(path)) {
          return [];
        }
      }
    }
    
    return result;
  }

  getStats() {
    let totalImports = 0;
    let totalExports = 0;
    let filesWithCircular = 0;
    
    const circular = new Set(this.findCircularImports().flat());
    
    for (const node of this.nodes.values()) {
      totalImports += node.imports.length;
      totalExports += node.exports.length;
      if (circular.has(node.path)) filesWithCircular++;
    }
    
    return {
      totalFiles: this.nodes.size,
      totalImports,
      totalExports,
      avgImportsPerFile: totalImports / this.nodes.size,
      avgExportsPerFile: totalExports / this.nodes.size,
      filesWithCircularDeps: filesWithCircular,
    };
  }

  private collectFiles(
    node: DAGNode,
    result: Array<{ path: string; content: string; language: string; hash: string }>
  ): void {
    if (node.type === 'file' && node.content && node.language) {
      const content = Buffer.from(node.content).toString('utf-8');
      result.push({
        path: node.path,
        content,
        language: node.language,
        hash: node.hash,
      });
    }
    
    for (const child of node.children) {
      this.collectFiles(child, result);
    }
  }

  private parseImports(content: string, language: string): SymbolImport[] {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.parseJSImports(content);
      case 'json':
        return [];
      default:
        return [];
    }
  }

  private parseExports(content: string, language: string): SymbolExport[] {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.parseJSExports(content);
      case 'json':
        return [{ symbol: 'default', line: 0, isDefault: true }];
      default:
        return [];
    }
  }

  private parseJSImports(content: string): SymbolImport[] {
    const imports: SymbolImport[] = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      let match = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g.exec(line);
      if (match) {
        imports.push({
          symbol: match[1],
          source: match[2],
          line: lineNum,
          isDefault: true,
          isNamespace: false,
          isDynamic: false,
        });
      }
      
      match = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g.exec(line);
      if (match) {
        imports.push({
          symbol: match[1],
          source: match[2],
          line: lineNum,
          isDefault: false,
          isNamespace: true,
          isDynamic: false,
        });
      }
      
      const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
      match = namedImportRegex.exec(line);
      if (match) {
        const source = match[2];
        const symbols = match[1].split(',').map(s => s.trim());
        
        for (const symbolStr of symbols) {
          const parts = symbolStr.split(/\s+as\s+/);
          const symbol = parts[0].trim();
          const alias = parts[1]?.trim();
          
          imports.push({
            symbol,
            alias,
            source,
            line: lineNum,
            isDefault: false,
            isNamespace: false,
            isDynamic: false,
          });
        }
      }
      
      const requireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      match = requireRegex.exec(line);
      if (match) {
        const source = match[3];
        
        if (match[1]) {
          const symbols = match[1].split(',').map(s => s.trim());
          for (const symbolStr of symbols) {
            const parts = symbolStr.split(':');
            const symbol = parts[0].trim();
            
            imports.push({
              symbol,
              source,
              line: lineNum,
              isDefault: false,
              isNamespace: false,
              isDynamic: false,
            });
          }
        } else if (match[2]) {
          imports.push({
            symbol: match[2],
            source,
            line: lineNum,
            isDefault: true,
            isNamespace: false,
            isDynamic: false,
          });
        }
      }
      
      const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      match = dynamicImportRegex.exec(line);
      if (match) {
        imports.push({
          symbol: '*',
          source: match[1],
          line: lineNum,
          isDefault: false,
          isNamespace: true,
          isDynamic: true,
        });
      }
      
      const reExportRegex = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
      match = reExportRegex.exec(line);
      if (match) {
        const source = match[2];
        const symbols = match[1].split(',').map(s => s.trim());
        
        for (const symbolStr of symbols) {
          const parts = symbolStr.split(/\s+as\s+/);
          const symbol = parts[0].trim();
          
          imports.push({
            symbol,
            source,
            line: lineNum,
            isDefault: false,
            isNamespace: false,
            isDynamic: false,
          });
        }
      }
      
      match = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g.exec(line);
      if (match) {
        imports.push({
          symbol: '*',
          source: match[1],
          line: lineNum,
          isDefault: false,
          isNamespace: true,
          isDynamic: false,
        });
      }
    }
    
    return imports;
  }

  private parseJSExports(content: string): SymbolExport[] {
    const exports: SymbolExport[] = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
      let match: RegExpExecArray | null;
      
      while ((match = namedExportRegex.exec(line)) !== null) {
        exports.push({
          symbol: match[1],
          line: lineNum,
          isDefault: false,
        });
      }
      
      const defaultExportRegex = /export\s+default\s+(?:(?:function|class)\s+)?(\w+)?/g;
      match = defaultExportRegex.exec(line);
      if (match) {
        exports.push({
          symbol: match[1] || 'default',
          line: lineNum,
          isDefault: true,
        });
      }
      
      const exportListRegex = /export\s+\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/g;
      match = exportListRegex.exec(line);
      if (match) {
        const symbols = match[1].split(',').map(s => s.trim());
        const reExportFrom = match[2];
        
        for (const symbolStr of symbols) {
          const parts = symbolStr.split(/\s+as\s+/);
          const symbol = parts.length > 1 ? parts[1].trim() : parts[0].trim();
          
          exports.push({
            symbol,
            line: lineNum,
            isDefault: symbol === 'default',
            reExportFrom,
          });
        }
      }
      
      const moduleExportsRegex = /module\.exports\s*=\s*(\w+)/g;
      match = moduleExportsRegex.exec(line);
      if (match) {
        exports.push({
          symbol: match[1],
          line: lineNum,
          isDefault: true,
        });
      }
      
      const moduleExportsObjRegex = /module\.exports\.(\w+)/g;
      while ((match = moduleExportsObjRegex.exec(line)) !== null) {
        exports.push({
          symbol: match[1],
          line: lineNum,
          isDefault: false,
        });
      }
      
      const exportsObjRegex = /exports\.(\w+)/g;
      while ((match = exportsObjRegex.exec(line)) !== null) {
        exports.push({
          symbol: match[1],
          line: lineNum,
          isDefault: false,
        });
      }
    }
    
    return exports;
  }

  private resolveAllDependencies(): void {
    const allPaths = this.getAllPaths();
    
    for (const [filePath, node] of this.nodes.entries()) {
      const fileDir = dirname(filePath);
      
      for (const imp of node.imports) {
        const resolvedPath = this.pathResolver.resolve(imp.source, fileDir, allPaths);
        
        if (resolvedPath && this.nodes.has(resolvedPath)) {
          node.directDependencies.add(resolvedPath);
          
          const depNode = this.nodes.get(resolvedPath)!;
          depNode.directDependents.add(filePath);
        }
      }
    }
  }

  private buildSymbolMaps(): void {
    for (const [filePath, node] of this.nodes.entries()) {
      const symbolMap = new Map<string, string[]>();
      
      for (const imp of node.imports) {
        const fileDir = dirname(filePath);
        const resolvedPath = this.pathResolver.resolve(imp.source, fileDir, this.getAllPaths());
        
        if (resolvedPath) {
          const symbols = symbolMap.get(resolvedPath) || [];
          
          if (imp.isNamespace) {
            symbols.push('*');
          } else {
            symbols.push(imp.symbol);
          }
          
          symbolMap.set(resolvedPath, symbols);
        }
      }
      
      node.symbolMap = symbolMap;
    }
  }

  private getAllPaths(): string[] {
    return Array.from(this.nodes.keys());
  }

  private deduplicateCycles(cycles: string[][]): string[][] {
    const normalized = cycles.map(cycle => {
      const sorted = [...cycle].sort();
      return sorted.join('|');
    });
    
    const unique = new Set(normalized);
    
    return Array.from(unique).map(str => str.split('|'));
  }
}

class PathResolver {
  private static readonly EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  
  resolve(importPath: string, fromDir: string, allPaths: string[]): string | null {
    if (this.isNodeModule(importPath)) {
      return null;
    }
    
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }
    
    const basePath = this.joinPaths(fromDir, importPath);
    
    const candidates = this.generateCandidates(basePath);
    
    for (const candidate of candidates) {
      if (allPaths.includes(candidate)) {
        return candidate;
      }
    }
    
    return null;
  }
  
  private isNodeModule(importPath: string): boolean {
    return !importPath.startsWith('.') && !importPath.startsWith('/');
  }
  
  private generateCandidates(basePath: string): string[] {
    const candidates: string[] = [];
    
    const normalizedBase = this.normalizePath(basePath);
    
    const ext = extname(normalizedBase);
    if (ext) {
      candidates.push(normalizedBase);
      return candidates;
    }
    
    for (const extension of PathResolver.EXTENSIONS) {
      candidates.push(normalizedBase + extension);
    }
    
    for (const extension of PathResolver.EXTENSIONS) {
      candidates.push(this.joinPaths(normalizedBase, 'index' + extension));
    }
    
    return candidates;
  }
  
  private joinPaths(...parts: string[]): string {
    const joined = parts.join('/');
    return this.normalizePath(joined);
  }
  
  private normalizePath(path: string): string {
    const parts = path.split('/');
    const normalized: string[] = [];
    
    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.' && part !== '') {
        normalized.push(part);
      }
    }
    
    return normalized.join('/') || '.';
  }
}
