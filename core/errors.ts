// kernel/src/ast/dependency_graph.ts
import * as ts from 'typescript';
import * as path from 'path';
import { createHash } from 'crypto';
import { Logger } from '../../../core/logger.js';
import { KlynError } from '../../../core/errors.js';
import { PerformanceMonitor } from '../../../core/performance.js';

export class DependencyGraphError extends KlynError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DEPENDENCY_GRAPH_ERROR', context);
    this.name = 'DependencyGraphError';
  }
}

export interface DAGNode {
  readonly id: string;
  readonly filePath: string;
  readonly hash: string;
  readonly content: string;
  readonly children?: readonly DAGNode[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ImportStatement {
  readonly type: 'import' | 'export' | 'require' | 'dynamic-import';
  readonly source: string;
  readonly specifiers: readonly string[];
  readonly isTypeOnly: boolean;
  readonly line: number;
  readonly column: number;
}

export interface DependencyNode {
  readonly filePath: string;
  readonly absolutePath: string;
  readonly hash: string;
  readonly imports: readonly ImportStatement[];
  readonly exports: readonly string[];
  readonly dependencies: Set<string>;
  readonly dependents: Set<string>;
  readonly content: string;
}

export interface CircularDependency {
  readonly cycle: readonly string[];
  readonly severity: 'warning' | 'error';
}

export interface DependencyGraphStats {
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly circularDependencies: number;
  readonly maxDepth: number;
  readonly isolatedNodes: number;
}

export class ASTDependencyGraph {
  private readonly logger = Logger.getInstance();
  private readonly perfMonitor = PerformanceMonitor.getInstance();
  private readonly nodes = new Map<string, DependencyNode>();
  private readonly pathAliases = new Map<string, string>();
  private readonly cache = new Map<string, string>();
  private baseDir: string = process.cwd();

  constructor(baseDir?: string, aliases?: Record<string, string>) {
    if (baseDir) {
      this.baseDir = path.resolve(baseDir);
    }

    if (aliases) {
      for (const [alias, target] of Object.entries(aliases)) {
        this.pathAliases.set(alias, target);
      }
    }

    this.logger.debug('ASTDependencyGraph initialized', {
      baseDir: this.baseDir,
      aliases: Object.keys(aliases || {})
    });
  }

  async buildFromDAG(dagRoot: DAGNode): Promise<void> {
    const operationId = `buildFromDAG:${Date.now()}`;
    this.perfMonitor.start(operationId);

    try {
      this.logger.info('Building dependency graph from DAG', { rootId: dagRoot.id });

      const queue: DAGNode[] = [dagRoot];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const node = queue.shift()!;

        if (visited.has(node.id)) {
          continue;
        }

        visited.add(node.id);

        await this.processNode(node);

        if (node.children && node.children.length > 0) {
          queue.push(...node.children);
        }
      }

      this.buildDependentRelationships();

      const metrics = this.perfMonitor.end(operationId);
      this.logger.info('Dependency graph built successfully', {
        totalNodes: this.nodes.size,
        duration: metrics.duration,
        memoryUsed: metrics.memoryUsed
      });

      if (metrics.duration > 5) {
        this.logger.warn('Graph building exceeded 5ms threshold', {
          duration: metrics.duration,
          nodes: this.nodes.size
        });
      }
    } catch (error) {
      this.perfMonitor.end(operationId);
      this.logger.error('Failed to build dependency graph', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new DependencyGraphError('Failed to build dependency graph from DAG', {
        rootId: dagRoot.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async processNode(dagNode: DAGNode): Promise<void> {
    const absolutePath = this.resolvePath(dagNode.filePath);
    const hash = this.computeHash(dagNode.content);

    if (this.cache.get(absolutePath) === hash) {
      this.logger.debug('Node already processed (cache hit)', { path: absolutePath });
      return;
    }

    const imports = this.extractImports(dagNode.content, dagNode.filePath);
    const exports = this.extractExports(dagNode.content);

    const dependencies = new Set<string>();
    for (const imp of imports) {
      const resolvedPath = this.resolveImportPath(imp.source, dagNode.filePath);
      dependencies.add(resolvedPath);
    }

    const node: DependencyNode = {
      filePath: dagNode.filePath,
      absolutePath,
      hash,
      imports,
      exports,
      dependencies,
      dependents: new Set<string>(),
      content: dagNode.content
    };

    this.nodes.set(absolutePath, node);
    this.cache.set(absolutePath, hash);

    this.logger.debug('Processed node', {
      path: absolutePath,
      imports: imports.length,
      exports: exports.length,
      dependencies: dependencies.size
    });
  }

  private extractImports(content: string, filePath: string): ImportStatement[] {
    const imports: ImportStatement[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const specifiers: string[] = [];
            
            if (node.importClause) {
              if (node.importClause.name) {
                specifiers.push(node.importClause.name.text);
              }

              if (node.importClause.namedBindings) {
                if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                  specifiers.push(`* as ${node.importClause.namedBindings.name.text}`);
                } else if (ts.isNamedImports(node.importClause.namedBindings)) {
                  for (const element of node.importClause.namedBindings.elements) {
                    specifiers.push(element.name.text);
                  }
                }
              }
            }

            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

            imports.push({
              type: 'import',
              source: moduleSpecifier.text,
              specifiers: Object.freeze(specifiers),
              isTypeOnly: node.importClause?.isTypeOnly ?? false,
              line: line + 1,
              column: character + 1
            });
          }
        } else if (ts.isExportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
            const specifiers: string[] = [];

            if (node.exportClause && ts.isNamedExports(node.exportClause)) {
              for (const element of node.exportClause.elements) {
                specifiers.push(element.name.text);
              }
            }

            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

            imports.push({
              type: 'export',
              source: moduleSpecifier.text,
              specifiers: Object.freeze(specifiers),
              isTypeOnly: node.isTypeOnly,
              line: line + 1,
              column: character + 1
            });
          }
        } else if (ts.isCallExpression(node)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteral(arg)) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

              imports.push({
                type: 'dynamic-import',
                source: arg.text,
                specifiers: Object.freeze([]),
                isTypeOnly: false,
                line: line + 1,
                column: character + 1
              });
            }
          } else if (
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'
          ) {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteral(arg)) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

              imports.push({
                type: 'require',
                source: arg.text,
                specifiers: Object.freeze([]),
                isTypeOnly: false,
                line: line + 1,
                column: character + 1
              });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error) {
      this.logger.warn('Failed to parse imports using AST, falling back to regex', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });

      imports.push(...this.extractImportsRegex(content));
    }

    return imports;
  }

  private extractImportsRegex(content: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    const lines = content.split('\n');

    const importRegex = /^\s*import\s+(?:(?:(\w+)|(?:\{([^}]+)\})|(?:\*\s+as\s+(\w+)))(?:\s*,\s*)?)+\s+from\s+['"]([^'"]+)['"]/;
    const requireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      let match = importRegex.exec(line);
      if (match) {
        const [, defaultImport, namedImports, namespaceImport, source] = match;
        const specifiers: string[] = [];

        if (defaultImport) specifiers.push(defaultImport);
        if (namedImports) {
          specifiers.push(...namedImports.split(',').map(s => s.trim()));
        }
        if (namespaceImport) specifiers.push(`* as ${namespaceImport}`);

        imports.push({
          type: 'import',
          source: source,
          specifiers: Object.freeze(specifiers),
          isTypeOnly: line.includes('import type'),
          line: i + 1,
          column: line.indexOf('import') + 1
        });
        continue;
      }

      match = requireRegex.exec(line);
      if (match) {
        const [, namedRequires, defaultRequire, source] = match;
        const specifiers: string[] = [];

        if (defaultRequire) specifiers.push(defaultRequire);
        if (namedRequires) {
          specifiers.push(...namedRequires.split(',').map(s => s.trim()));
        }

        imports.push({
          type: 'require',
          source: source,
          specifiers: Object.freeze(specifiers),
          isTypeOnly: false,
          line: i + 1,
          column: line.indexOf('require') + 1
        });
        continue;
      }

      match = dynamicImportRegex.exec(line);
      if (match) {
        imports.push({
          type: 'dynamic-import',
          source: match[1],
          specifiers: Object.freeze([]),
          isTypeOnly: false,
          line: i + 1,
          column: line.indexOf('import(') + 1
        });
      }
    }

    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];

    try {
      const sourceFile = ts.createSourceFile(
        'module.ts',
        content,
        ts.ScriptTarget.Latest,
        true
      );

      const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
          if (
            node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
            node.name
          ) {
            exports.push(node.name.text);
          }
        } else if (ts.isVariableStatement(node)) {
          if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
            for (const declaration of node.declarationList.declarations) {
              if (ts.isIdentifier(declaration.name)) {
                exports.push(declaration.name.text);
              }
            }
          }
        } else if (ts.isExportDeclaration(node)) {
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const element of node.exportClause.elements) {
              exports.push(element.name.text);
            }
          }
        } else if (ts.isExportAssignment(node)) {
          exports.push('default');
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error) {
      this.logger.warn('Failed to parse exports using AST, falling back to regex', {
        error: error instanceof Error ? error.message : String(error)
      });

      const exportRegex = /export\s+(?:(?:const|let|var|function|class|interface|type|enum)\s+)?(\w+)/g;
      let match: RegExpExecArray | null;

      while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
    }

    return exports;
  }

  private resolveImportPath(importPath: string, fromFile: string): string {
    if (importPath.startsWith('.')) {
      const dir = path.dirname(this.resolvePath(fromFile));
      return path.resolve(dir, importPath);
    }

    for (const [alias, target] of this.pathAliases.entries()) {
      if (importPath.startsWith(alias)) {
        const relativePath = importPath.slice(alias.length);
        return path.resolve(this.baseDir, target, relativePath);
      }
    }

    return importPath;
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }
    return path.resolve(this.baseDir, filePath);
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private buildDependentRelationships(): void {
    for (const [absolutePath, node] of this.nodes.entries()) {
      for (const dependency of node.dependencies) {
        const dependencyNode = this.nodes.get(dependency);
        if (dependencyNode) {
          dependencyNode.dependents.add(absolutePath);
        }
      }
    }
  }

  getDependencies(filePath: string): string[] {
    const absolutePath = this.resolvePath(filePath);
    const node = this.nodes.get(absolutePath);

    if (!node) {
      this.logger.warn('Node not found in dependency graph', { filePath: absolutePath });
      return [];
    }

    return Array.from(node.dependencies);
  }

  getDependents(filePath: string): string[] {
    const absolutePath = this.resolvePath(filePath);
    const node = this.nodes.get(absolutePath);

    if (!node) {
      this.logger.warn('Node not found in dependency graph', { filePath: absolutePath });
      return [];
    }

    return Array.from(node.dependents);
  }

  findCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];

    const dfs = (nodePath: string): boolean => {
      if (recursionStack.has(nodePath)) {
        const cycleStart = currentPath.indexOf(nodePath);
        if (cycleStart !== -1) {
          const cycle = currentPath.slice(cycleStart);
          cycle.push(nodePath);
          cycles.push(cycle);
        }
        return true;
      }

      if (visited.has(nodePath)) {
        return false;
      }

      visited.add(nodePath);
      recursionStack.add(nodePath);
      currentPath.push(nodePath);

      const node = this.nodes.get(nodePath);
      if (node) {
        for (const dependency of node.dependencies) {
          if (this.nodes.has(dependency)) {
            dfs(dependency);
          }
        }
      }

      currentPath.pop();
      recursionStack.delete(nodePath);

      return false;
    };

    for (const nodePath of this.nodes.keys()) {
      if (!visited.has(nodePath)) {
        dfs(nodePath);
      }
    }

    if (cycles.length > 0) {
      this.logger.warn('Circular dependencies detected', {
        count: cycles.length,
        cycles: cycles.map(cycle => cycle.join(' → '))
      });
    }

    return cycles;
  }

  getCircularDependenciesDetailed(): CircularDependency[] {
    const cycles = this.findCircularDependencies();
    
    return cycles.map(cycle => ({
      cycle: Object.freeze(cycle),
      severity: cycle.length > 3 ? 'error' : 'warning'
    }));
  }

  getTransitiveDependencies(filePath: string): string[] {
    const absolutePath = this.resolvePath(filePath);
    const node = this.nodes.get(absolutePath);

    if (!node) {
      return [];
    }

    const visited = new Set<string>();
    const queue: string[] = [absolutePath];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const currentNode = this.nodes.get(current);
      if (currentNode) {
        for (const dependency of currentNode.dependencies) {
          if (!visited.has(dependency) && this.nodes.has(dependency)) {
            queue.push(dependency);
          }
        }
      }
    }

    visited.delete(absolutePath);
    return Array.from(visited);
  }

  getTransitiveDependents(filePath: string): string[] {
    const absolutePath = this.resolvePath(filePath);
    const node = this.nodes.get(absolutePath);

    if (!node) {
      return [];
    }

    const visited = new Set<string>();
    const queue: string[] = [absolutePath];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const currentNode = this.nodes.get(current);
      if (currentNode) {
        for (const dependent of currentNode.dependents) {
          if (!visited.has(dependent)) {
            queue.push(dependent);
          }
        }
      }
    }

    visited.delete(absolutePath);
    return Array.from(visited);
  }

  getNode(filePath: string): Readonly<DependencyNode> | undefined {
    const absolutePath = this.resolvePath(filePath);
    const node = this.nodes.get(absolutePath);
    
    if (!node) {
      return undefined;
    }

    return Object.freeze({
      ...node,
      dependencies: new Set(node.dependencies),
      dependents: new Set(node.dependents)
    });
  }

  getAllNodes(): readonly Readonly<DependencyNode>[] {
    return Array.from(this.nodes.values()).map(node =>
      Object.freeze({
        ...node,
        dependencies: new Set(node.dependencies),
        dependents: new Set(node.dependents)
      })
    );
  }

  getStats(): DependencyGraphStats {
    let totalEdges = 0;
    let maxDepth = 0;
    let isolatedNodes = 0;

    for (const node of this.nodes.values()) {
      totalEdges += node.dependencies.size;

      if (node.dependencies.size === 0 && node.dependents.size === 0) {
        isolatedNodes++;
      }

      const depth = this.calculateDepth(node.absolutePath);
      maxDepth = Math.max(maxDepth, depth);
    }

    const circularDeps = this.findCircularDependencies();

    return {
      totalNodes: this.nodes.size,
      totalEdges,
      circularDependencies: circularDeps.length,
      maxDepth,
      isolatedNodes
    };
  }

  private calculateDepth(filePath: string, visited = new Set<string>()): number {
    if (visited.has(filePath)) {
      return 0;
    }

    visited.add(filePath);

    const node = this.nodes.get(filePath);
    if (!node || node.dependencies.size === 0) {
      return 0;
    }

    let maxDepth = 0;
    for (const dependency of node.dependencies) {
      if (this.nodes.has(dependency)) {
        const depth = this.calculateDepth(dependency, new Set(visited));
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    return maxDepth + 1;
  }

  topologicalSort(): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (nodePath: string): void => {
      if (visited.has(nodePath)) {
        return;
      }

      if (temp.has(nodePath)) {
        throw new DependencyGraphError('Cannot perform topological sort on graph with cycles', {
          node: nodePath
        });
      }

      temp.add(nodePath);

      const node = this.nodes.get(nodePath);
      if (node) {
        for (const dependency of node.dependencies) {
          if (this.nodes.has(dependency)) {
            visit(dependency);
          }
        }
      }

      temp.delete(nodePath);
      visited.add(nodePath);
      sorted.push(nodePath);
    };

    for (const nodePath of this.nodes.keys()) {
      if (!visited.has(nodePath)) {
        visit(nodePath);
      }
    }

    return sorted;
  }

  findRootNodes(): string[] {
    const roots: string[] = [];

    for (const [absolutePath, node] of this.nodes.entries()) {
      if (node.dependents.size === 0) {
        roots.push(absolutePath);
      }
    }

    return roots;
  }

  findLeafNodes(): string[] {
    const leaves: string[] = [];

    for (const [absolutePath, node] of this.nodes.entries()) {
      if (node.dependencies.size === 0) {
        leaves.push(absolutePath);
      }
    }

    return leaves;
  }

  clear(): void {
    this.nodes.clear();
    this.cache.clear();
    this.logger.debug('Dependency graph cleared');
  }

  exportGraph(): Record<string, { dependencies: string[]; dependents: string[] }> {
    const graph: Record<string, { dependencies: string[]; dependents: string[] }> = {};

    for (const [absolutePath, node] of this.nodes.entries()) {
      graph[absolutePath] = {
        dependencies: Array.from(node.dependencies),
        dependents: Array.from(node.dependents)
      };
    }

    return graph;
  }

  visualize(): string {
    const lines: string[] = ['digraph DependencyGraph {'];
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, style=rounded];');

    const nodeIds = new Map<string, string>();
    let idCounter = 0;

    for (const absolutePath of this.nodes.keys()) {
      const id = `node${idCounter++}`;
      nodeIds.set(absolutePath, id);
      const label = path.basename(absolutePath);
      lines.push(`  ${id} [label="${label}"];`);
    }

    for (const [absolutePath, node] of this.nodes.entries()) {
      const fromId = nodeIds.get(absolutePath)!;
      for (const dependency of node.dependencies) {
        const toId = nodeIds.get(dependency);
        if (toId) {
          lines.push(`  ${fromId} -> ${toId};`);
        }
      }
    }

    lines.push('}');

    return lines.join('\n');
  }
}

export const createDependencyGraph = (
  baseDir?: string,
  aliases?: Record<string, string>
): ASTDependencyGraph => {
  return new ASTDependencyGraph(baseDir, aliases);
};

export default ASTDependencyGraph;
