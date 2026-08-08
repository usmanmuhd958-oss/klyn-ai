// 1.brain/cognitive_router.ts
import type { DAGNode } from '../kernel/src/pipeline/repo_ingest.js';
import type { ASTDependencyGraph } from '../kernel/src/ast/dependency_graph.js';

export interface QueryIntent {
  type: 'read' | 'modify' | 'create' | 'delete' | 'refactor' | 'analyze';
  confidence: number;
  targetFiles: string[];
  symbols: string[];
  operation: string;
}

export interface ContextWindow {
  relevantFiles: Array<{ path: string; content: string; score: number }>;
  dependencies: Map<string, string[]>;
  symbols: Map<string, string[]>;
  totalTokens: number;
}

export interface RouteDecision {
  intent: QueryIntent;
  context: ContextWindow;
  strategy: 'direct' | 'incremental' | 'multi-step';
  estimatedComplexity: number;
}

/**
 * Phase 5: reverse symbol->file lookup surface. Implemented by the IndexStore
 * (src/indexer/index-store.ts) so context assembly resolves the files that
 * declare a query's symbols without walking the whole DAG.
 */
export interface SymbolLookup {
  /** Repo-relative file paths that declare a symbol with this name. */
  getSymbolLocations(symbol: string): string[];
  /** Batch variant; the router prefers this when present. */
  querySymbolLocations?(symbols: string[]): Map<string, string[]>;
}

export class CognitiveRouter {
  private static readonly MAX_CONTEXT_TOKENS = 100000;
  private static readonly KEYWORDS = {
    read: ['show', 'get', 'find', 'search', 'display', 'list', 'what', 'where'],
    modify: ['change', 'update', 'edit', 'modify', 'fix', 'patch', 'replace'],
    create: ['create', 'add', 'new', 'generate', 'implement', 'write', 'build'],
    delete: ['delete', 'remove', 'drop', 'clear', 'clean'],
    refactor: ['refactor', 'restructure', 'reorganize', 'optimize', 'improve'],
    analyze: ['analyze', 'explain', 'why', 'how', 'impact', 'dependencies'],
  };

  private rootPath: string;
  /** Memoized path -> file node index (rebuilt lazily per DAG identity). */
  private fileIndex: Map<string, DAGNode> | null = null;
  private fileIndexFor: DAGNode | null = null;
  private allFilesCache: DAGNode[] | null = null;
  private allFilesFor: DAGNode | null = null;

  constructor(
    private dagRoot: DAGNode,
    private depGraph?: ASTDependencyGraph,
    private symbolIndex?: SymbolLookup,
    rootPath?: string
  ) {
    this.rootPath = (rootPath || dagRoot.path).replace(/\/+$/, '');
  }

  /** Drop memoized caches; call after the DAG tree or graph changes. */
  invalidateFileIndex(): void {
    this.fileIndex = null;
    this.fileIndexFor = null;
    this.allFilesCache = null;
    this.allFilesFor = null;
  }

  route(query: string): RouteDecision {
    const intent = this.classifyIntent(query);
    const context = this.buildContext(query, intent);
    const strategy = this.selectStrategy(intent, context);
    const complexity = this.estimateComplexity(intent, context);

    return {
      intent,
      context,
      strategy,
      estimatedComplexity: complexity,
    };
  }

  private classifyIntent(query: string): QueryIntent {
    const normalized = query.toLowerCase();
    const scores = new Map<string, number>();

    for (const [type, keywords] of Object.entries(CognitiveRouter.KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (normalized.includes(keyword)) {
          score += 1;
        }
      }
      scores.set(type, score);
    }

    let maxScore = 0;
    let intentType: QueryIntent['type'] = 'read';

    for (const [type, score] of scores.entries()) {
      if (score > maxScore) {
        maxScore = score;
        intentType = type as QueryIntent['type'];
      }
    }

    const confidence = maxScore > 0 ? Math.min(maxScore / 3, 1.0) : 0.3;

    const targetFiles = this.extractFileReferences(query);
    const symbols = this.extractSymbolReferences(query);

    return {
      type: intentType,
      confidence,
      targetFiles,
      symbols,
      operation: query,
    };
  }

  private buildContext(query: string, intent: QueryIntent): ContextWindow {
    const relevantFiles: Array<{ path: string; content: string; score: number }> = [];
    const dependencies = new Map<string, string[]>();
    const symbols = new Map<string, string[]>();

    // Phase 5: resolve the candidate set through the symbol index + explicit
    // file references instead of scoring every file in the repository.
    let candidates = this.resolveCandidates(intent);
    if (candidates.length === 0) {
      // Symbol-less queries (or no index attached) keep the full-DAG fallback.
      candidates = this.getAllFiles();
    }

    for (const file of candidates) {
      const score = this.scoreFileRelevance(file, query, intent);

      if (score > 0.1) {
        const content = file.content ? Buffer.from(file.content).toString('utf-8') : '';
        relevantFiles.push({ path: file.path, content, score });

        if (this.depGraph) {
          const deps = this.depGraph.getDirectDependencies(file.path);
          if (deps.length > 0) {
            dependencies.set(file.path, deps);
          }

          const fileNode = this.depGraph.getFileNode(file.path);
          if (fileNode) {
            const exportedSymbols = fileNode.exports.map(e => e.symbol);
            if (exportedSymbols.length > 0) {
              symbols.set(file.path, exportedSymbols);
            }
          }
        }
      }
    }

    relevantFiles.sort((a, b) => b.score - a.score);

    let totalTokens = 0;
    const filteredFiles: typeof relevantFiles = [];

    for (const file of relevantFiles) {
      const estimatedTokens = Math.ceil(file.content.length / 4);
      if (totalTokens + estimatedTokens > CognitiveRouter.MAX_CONTEXT_TOKENS) {
        break;
      }
      filteredFiles.push(file);
      totalTokens += estimatedTokens;
    }

    return {
      relevantFiles: filteredFiles,
      dependencies,
      symbols,
      totalTokens,
    };
  }

  /**
   * Phase 5: candidate set = explicit file references ∪ symbol-declaring
   * files (via the reverse symbol index). O(candidates), never O(whole repo).
   */
  private resolveCandidates(intent: QueryIntent): DAGNode[] {
    if (!this.symbolIndex && intent.targetFiles.length === 0) return [];
    const index = this.getFileIndex();
    const paths = new Set<string>();

    // 1) explicit file references in the query.
    for (const target of intent.targetFiles) {
      const nodePath = this.toNodePath(target);
      if (index.has(nodePath)) {
        paths.add(nodePath);
        continue;
      }
      for (const p of index.keys()) {
        if (
          p === nodePath ||
          p.endsWith(`/${nodePath}`) ||
          (nodePath.includes('.') && p.includes(nodePath)) ||
          (nodePath.startsWith('/') && nodePath.endsWith(`/${p}`))
        ) {
          paths.add(p);
        }
      }
    }

    // 2) symbols mentioned in the query -> declaring files (reverse index).
    if (this.symbolIndex && intent.symbols.length > 0) {
      const batch = this.symbolIndex.querySymbolLocations
        ? this.symbolIndex.querySymbolLocations(intent.symbols)
        : null;
      if (batch) {
        for (const files of batch.values()) {
          for (const rel of files) {
            const nodePath = this.toNodePath(rel);
            if (index.has(nodePath)) paths.add(nodePath);
          }
        }
      } else {
        for (const symbol of intent.symbols) {
          for (const rel of this.symbolIndex.getSymbolLocations(symbol)) {
            const nodePath = this.toNodePath(rel);
            if (index.has(nodePath)) paths.add(nodePath);
          }
        }
      }
    }

    const out: DAGNode[] = [];
    for (const p of paths) {
      const node = index.get(p);
      if (node) out.push(node);
    }
    return out;
  }

  /**
   * Convert a symbol-location / query path into the DAG's path convention:
   * repo-relative DAG keys stay relative; absolute DAG keys get the root
   * prefix so the lookup always lands on the index.
   */
  private toNodePath(p: string): string {
    if (p.startsWith('/')) return p;
    const index = this.getFileIndex();
    if (index.size === 0) return p;
    const firstKey = index.keys().next().value as string;
    return firstKey.startsWith('/') ? `${this.rootPath}/${p}` : p;
  }

  private getFileIndex(): Map<string, DAGNode> {
    if (this.fileIndex && this.fileIndexFor === this.dagRoot) return this.fileIndex;
    const index = new Map<string, DAGNode>();
    for (const file of this.getAllFiles()) index.set(file.path, file);
    this.fileIndex = index;
    this.fileIndexFor = this.dagRoot;
    return index;
  }

  private getAllFiles(): DAGNode[] {
    if (this.allFilesCache && this.allFilesFor === this.dagRoot) return this.allFilesCache;
    this.allFilesCache = this.collectAllFiles(this.dagRoot);
    this.allFilesFor = this.dagRoot;
    return this.allFilesCache;
  }

  private scoreFileRelevance(file: DAGNode, query: string, intent: QueryIntent): number {
    if (file.type !== 'file') return 0;

    let score = 0;

    if (intent.targetFiles.some(target => file.path.includes(target))) {
      score += 1.0;
    }

    const normalizedQuery = query.toLowerCase();
    const pathLower = file.path.toLowerCase();

    const queryWords = normalizedQuery.split(/\s+/);
    for (const word of queryWords) {
      if (word.length > 3 && pathLower.includes(word)) {
        score += 0.3;
      }
    }

    if (file.content) {
      const content = Buffer.from(file.content).toString('utf-8').toLowerCase();

      for (const symbol of intent.symbols) {
        if (content.includes(symbol.toLowerCase())) {
          score += 0.5;
        }
      }

      const contentMatches = queryWords.filter(word =>
        word.length > 3 && content.includes(word)
      ).length;

      score += contentMatches * 0.1;
    }

    const ext = file.path.split('.').pop() || '';
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  private selectStrategy(intent: QueryIntent, context: ContextWindow): RouteDecision['strategy'] {
    if (intent.type === 'read' || intent.type === 'analyze') {
      return 'direct';
    }

    if (context.relevantFiles.length <= 3) {
      return 'direct';
    }

    if (intent.type === 'refactor' || context.dependencies.size > 5) {
      return 'multi-step';
    }

    return 'incremental';
  }

  private estimateComplexity(intent: QueryIntent, context: ContextWindow): number {
    let complexity = 0;

    complexity += context.relevantFiles.length * 10;
    complexity += context.dependencies.size * 5;
    complexity += context.symbols.size * 2;

    const typeMultiplier = {
      read: 1,
      analyze: 1.5,
      modify: 2,
      create: 2.5,
      refactor: 3,
      delete: 1.5,
    };

    complexity *= typeMultiplier[intent.type];

    return Math.round(complexity);
  }

  private extractFileReferences(query: string): string[] {
    const files: string[] = [];
    const patterns = [
      /([a-zA-Z0-9_\-/]+\.[a-zA-Z]{2,4})/g,
      /`([^`]+)`/g,
      /'([^']+\.[a-zA-Z]{2,4})'/g,
      /"([^"]+\.[a-zA-Z]{2,4})"/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        files.push(match[1]);
      }
    }

    return [...new Set(files)];
  }

  private extractSymbolReferences(query: string): string[] {
    const symbols: string[] = [];
    const patterns = [
      /\b([A-Z][a-zA-Z0-9]+)\b/g,
      /\b([a-z][a-zA-Z0-9]+)\(/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        const symbol = match[1];
        if (symbol.length > 2) {
          symbols.push(symbol);
        }
      }
    }

    return [...new Set(symbols)];
  }

  private collectAllFiles(node: DAGNode): DAGNode[] {
    const files: DAGNode[] = [];

    if (node.type === 'file') {
      files.push(node);
    }

    for (const child of node.children) {
      files.push(...this.collectAllFiles(child));
    }

    return files;
  }
}
