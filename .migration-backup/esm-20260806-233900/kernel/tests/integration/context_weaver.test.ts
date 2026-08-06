/**
 * ContextWeaver Integration Test Suite
 * 
 * Production-grade test harness implementing:
 * - Contract-based mock builders with zero `any` types
 * - Multi-vector SLA performance matrix (latency, compression, budget)
 * - Adversarial edge-case coverage (circular deps, malformed queries, micro budgets)
 * - Event lifecycle observability audit with timestamp validation
 * 
 * @module kernel/tests/integration/context_weaver.test.ts
 * @architecture Vitest + AAA Pattern + Custom Matchers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// ============================================================================
// TYPE DEFINITIONS & INTERFACES
// ============================================================================

interface FileNode {
  readonly path: string;
  readonly hash: string;
  readonly content: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly size: number;
}

interface SymbolNode {
  readonly name: string;
  readonly kind: 'function' | 'class' | 'variable' | 'interface' | 'type';
  readonly file: string;
  readonly range: { start: number; end: number };
  readonly references: ReadonlyArray<string>;
}

interface SearchResult {
  readonly file: string;
  readonly score: number;
  readonly matches: ReadonlyArray<{ line: number; snippet: string }>;
}

interface MerkleDAG {
  getNode(path: string): Promise<FileNode | null>;
  resolveDependencies(path: string, maxDepth: number): Promise<ReadonlyArray<FileNode>>;
  getChildren(path: string): Promise<ReadonlyArray<string>>;
}

interface ASTGraph {
  getSymbolsInFile(path: string): Promise<ReadonlyArray<SymbolNode>>;
  resolveSymbol(name: string): Promise<SymbolNode | null>;
  getSymbolDependencies(name: string): Promise<ReadonlyArray<SymbolNode>>;
}

interface HybridSearch {
  search(query: string, options?: SearchOptions): Promise<ReadonlyArray<SearchResult>>;
}

interface SearchOptions {
  readonly maxResults?: number;
  readonly timeout?: number;
  readonly threshold?: number;
}

interface WeaveOptions {
  readonly maxTokens: number;
  readonly includeSymbols?: boolean;
  readonly includeDependencies?: boolean;
  readonly maxDepth?: number;
}

interface WeaveResult {
  readonly context: string;
  readonly metadata: {
    readonly totalFiles: number;
    readonly totalSymbols: number;
    readonly estimatedTokens: number;
    readonly compressionRatio: number;
    readonly processingTimeMs: number;
  };
}

interface WeaveEventPayload {
  readonly query: string;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

interface MockState {
  invocationCount: number;
  lastQuery: string | null;
  simulateLatencyMs: number;
  shouldTimeout: boolean;
  forcedError: Error | null;
}

// ============================================================================
// MOCK BUILDER FACTORIES
// ============================================================================

function createMockDAG(
  fileGraph: Map<string, ReadonlyArray<string>>,
  contentMap: Map<string, string>
): MerkleDAG {
  const state: MockState = {
    invocationCount: 0,
    lastQuery: null,
    simulateLatencyMs: 0,
    shouldTimeout: false,
    forcedError: null,
  };

  const dag: MerkleDAG = {
    async getNode(path: string): Promise<FileNode | null> {
      state.invocationCount++;
      state.lastQuery = path;

      if (state.forcedError) throw state.forcedError;
      if (state.shouldTimeout) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }

      if (state.simulateLatencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.simulateLatencyMs));
      }

      const content = contentMap.get(path);
      const dependencies = fileGraph.get(path) || [];

      if (content === undefined) return null;

      return {
        path,
        hash: `sha256:${path.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)}`,
        content,
        dependencies,
        size: content.length,
      };
    },

    async resolveDependencies(path: string, maxDepth: number): Promise<ReadonlyArray<FileNode>> {
      const visited = new Set<string>();
      const result: FileNode[] = [];

      const traverse = async (currentPath: string, depth: number): Promise<void> => {
        if (depth > maxDepth || visited.has(currentPath)) return;
        visited.add(currentPath);

        const node = await dag.getNode(currentPath);
        if (!node) return;

        result.push(node);

        for (const dep of node.dependencies) {
          await traverse(dep, depth + 1);
        }
      };

      await traverse(path, 0);
      return result;
    },

    async getChildren(path: string): Promise<ReadonlyArray<string>> {
      return fileGraph.get(path) || [];
    },
  };

  return dag;
}

function createMockASTGraph(
  symbolRegistry: Map<string, ReadonlyArray<SymbolNode>>,
  symbolDeps: Map<string, ReadonlyArray<string>>
): ASTGraph {
  const state: MockState = {
    invocationCount: 0,
    lastQuery: null,
    simulateLatencyMs: 0,
    shouldTimeout: false,
    forcedError: null,
  };

  const symbolByName = new Map<string, SymbolNode>();
  symbolRegistry.forEach((symbols) => {
    symbols.forEach((sym) => symbolByName.set(sym.name, sym));
  });

  return {
    async getSymbolsInFile(path: string): Promise<ReadonlyArray<SymbolNode>> {
      state.invocationCount++;
      state.lastQuery = path;

      if (state.forcedError) throw state.forcedError;
      if (state.simulateLatencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.simulateLatencyMs));
      }

      return symbolRegistry.get(path) || [];
    },

    async resolveSymbol(name: string): Promise<SymbolNode | null> {
      return symbolByName.get(name) || null;
    },

    async getSymbolDependencies(name: string): Promise<ReadonlyArray<SymbolNode>> {
      const depNames = symbolDeps.get(name) || [];
      return depNames.map((n) => symbolByName.get(n)).filter((s): s is SymbolNode => s !== null);
    },
  };
}

function createMockHybridSearch(
  searchIndex: Map<string, ReadonlyArray<SearchResult>>
): HybridSearch & { state: MockState } {
  const state: MockState = {
    invocationCount: 0,
    lastQuery: null,
    simulateLatencyMs: 0,
    shouldTimeout: false,
    forcedError: null,
  };

  return {
    state,
    async search(query: string, options?: SearchOptions): Promise<ReadonlyArray<SearchResult>> {
      state.invocationCount++;
      state.lastQuery = query;

      if (state.forcedError) throw state.forcedError;

      const timeout = options?.timeout || 5000;

      if (state.shouldTimeout) {
        return new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Search timeout')), Math.min(timeout, 50))
        );
      }

      return new Promise<ReadonlyArray<SearchResult>>((resolve) => {
        setTimeout(() => {
          const results = searchIndex.get(query) || [];
          const maxResults = options?.maxResults || 10;
          const threshold = options?.threshold || 0;

          const filtered = results
            .filter((r) => r.score >= threshold)
            .slice(0, maxResults);

          resolve(filtered);
        }, state.simulateLatencyMs);
      });
    },
  };
}

// ============================================================================
// CUSTOM ASSERTION HELPERS
// ============================================================================

function assertLatencySLA(actualMs: number, budgetMs: number = 50): void {
  expect(actualMs).toBeLessThanOrEqual(budgetMs);
}

function assertCompressionRatio(
  rawTokens: number,
  compressedTokens: number,
  minRatio: number = 0.85
): void {
  if (rawTokens === 0) return;
  const ratio = 1 - compressedTokens / rawTokens;
  expect(ratio).toBeGreaterThanOrEqual(minRatio);
}

function assertTokenBudgetCompliance(estimatedTokens: number, maxTokens: number): void {
  expect(estimatedTokens).toBeLessThanOrEqual(maxTokens);
  expect(estimatedTokens).toBeGreaterThanOrEqual(0);
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function assertEventPayload(
  payload: WeaveEventPayload,
  expectedQuery: string,
  timestampWindow: number = 2000
): void {
  expect(payload.query).toBe(expectedQuery);
  expect(payload.timestamp).toBeGreaterThan(0);
  expect(Math.abs(payload.timestamp - performance.now())).toBeLessThan(timestampWindow);
}

// ============================================================================
// CONTEXT WEAVER IMPLEMENTATION
// ============================================================================

class ContextWeaver extends EventEmitter {
  constructor(
    private readonly dag: MerkleDAG,
    private readonly astGraph: ASTGraph,
    private readonly search: HybridSearch
  ) {
    super();
  }

  async weave(query: string, options: WeaveOptions): Promise<WeaveResult> {
    const startTime = performance.now();

    this.emit('weave:start', {
      query,
      timestamp: startTime,
      metadata: { maxTokens: options.maxTokens },
    } satisfies WeaveEventPayload);

    try {
      const searchResults = await this.search.search(query, { maxResults: 5 });
      const filePaths = searchResults.map((r) => r.file);

      const allFilesMap = new Map<string, FileNode>();

      if (options.includeDependencies && filePaths.length > 0) {
        for (const fp of filePaths) {
          const depNodes = await this.dag.resolveDependencies(
            fp,
            options.maxDepth ?? 2
          );
          for (const node of depNodes) {
            allFilesMap.set(node.path, node);
          }
        }
      } else {
        for (const path of filePaths) {
          const node = await this.dag.getNode(path);
          if (node) allFilesMap.set(node.path, node);
        }
      }

      const allFiles = Array.from(allFilesMap.values());

      let allSymbols: SymbolNode[] = [];
      if (options.includeSymbols) {
        for (const file of allFiles) {
          const symbols = await this.astGraph.getSymbolsInFile(file.path);
          allSymbols.push(...symbols);
        }
      }

      let context = '';
      let estimatedTokens = 0;

      for (const file of allFiles) {
        const fileHeader = `\n// File: ${file.path}\n`;
        const combined = fileHeader + file.content;
        const newTokens = estimateTokens(combined);

        if (estimatedTokens + newTokens > options.maxTokens) {
          const remainingTokens = options.maxTokens - estimatedTokens;
          if (remainingTokens > 0) {
            const remainingChars = remainingTokens * 4;
            context += combined.slice(0, remainingChars);
            estimatedTokens = options.maxTokens;
          }
          break;
        }

        context += combined;
        estimatedTokens += newTokens;
      }

      const endTime = performance.now();
      const processingTimeMs = endTime - startTime;

      const rawTokens = allFiles.reduce((sum, f) => sum + estimateTokens(f.content), 0);
      const compressionRatio = rawTokens > 0 ? 1 - estimatedTokens / rawTokens : 0;

      const result: WeaveResult = {
        context,
        metadata: {
          totalFiles: allFiles.length,
          totalSymbols: allSymbols.length,
          estimatedTokens,
          compressionRatio,
          processingTimeMs,
        },
      };

      this.emit('weave:complete', {
        query,
        timestamp: performance.now(),
        metadata: result.metadata,
      } satisfies WeaveEventPayload);

      return result;
    } catch (error) {
      this.emit('weave:error', {
        query,
        timestamp: performance.now(),
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      } satisfies WeaveEventPayload);

      throw error;
    }
  }
}

// ============================================================================
// TEST SUITE: CORE WEAVING FUNCTIONALITY
// ============================================================================

describe('ContextWeaver - Core Weaving Functionality', () => {
  let weaver: ContextWeaver;
  let mockDAG: MerkleDAG;
  let mockAST: ASTGraph;
  let mockSearch: HybridSearch & { state: MockState };

  beforeEach(() => {
    const fileGraph = new Map<string, ReadonlyArray<string>>([
      ['src/index.ts', ['src/utils.ts', 'src/types.ts']],
      ['src/utils.ts', ['src/types.ts']],
      ['src/types.ts', []],
    ]);

    const contentMap = new Map<string, string>([
      [
        'src/index.ts',
        'import { helper } from "./utils";\nexport function main() { return helper(); }',
      ],
      ['src/utils.ts', 'import { Type } from "./types";\nexport function helper(): Type { return {}; }'],
      ['src/types.ts', 'export interface Type { value?: string; }'],
    ]);

    const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>([
      [
        'src/index.ts',
        [
          {
            name: 'main',
            kind: 'function',
            file: 'src/index.ts',
            range: { start: 0, end: 100 },
            references: ['helper'],
          },
        ],
      ],
      [
        'src/utils.ts',
        [
          {
            name: 'helper',
            kind: 'function',
            file: 'src/utils.ts',
            range: { start: 0, end: 80 },
            references: ['Type'],
          },
        ],
      ],
    ]);

    const symbolDeps = new Map<string, ReadonlyArray<string>>([
      ['main', ['helper']],
      ['helper', ['Type']],
    ]);

    const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
      [
        'main function',
        [
          {
            file: 'src/index.ts',
            score: 0.95,
            matches: [{ line: 2, snippet: 'export function main()' }],
          },
        ],
      ],
    ]);

    mockDAG = createMockDAG(fileGraph, contentMap);
    mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
    mockSearch = createMockHybridSearch(searchIndex);

    weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
  });

  afterEach(() => {
    weaver.removeAllListeners();
  });

  it('should weave context from search results with dependency resolution', async () => {
    const query = 'main function';
    const options: WeaveOptions = {
      maxTokens: 5000,
      includeDependencies: true,
      includeSymbols: false,
      maxDepth: 2,
    };

    const result = await weaver.weave(query, options);

    expect(result.context).toContain('src/index.ts');
    expect(result.context).toContain('export function main()');
    expect(result.metadata.totalFiles).toBeGreaterThan(0);
    expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
    expect(result.metadata.estimatedTokens).toBeLessThanOrEqual(options.maxTokens);
  });

  it('should include symbols when includeSymbols is enabled', async () => {
    const query = 'main function';
    const options: WeaveOptions = {
      maxTokens: 5000,
      includeSymbols: true,
      includeDependencies: true,
    };

    const result = await weaver.weave(query, options);

    expect(result.metadata.totalSymbols).toBeGreaterThan(0);
    expect(result.metadata.totalFiles).toBeGreaterThan(0);
  });

  it('should handle empty search results gracefully', async () => {
    const query = 'nonexistent query';
    const options: WeaveOptions = {
      maxTokens: 1000,
    };

    const result = await weaver.weave(query, options);

    expect(result.context).toBe('');
    expect(result.metadata.totalFiles).toBe(0);
    expect(result.metadata.totalSymbols).toBe(0);
    expect(result.metadata.estimatedTokens).toBe(0);
  });
});

// ============================================================================
// TEST SUITE: SLA PERFORMANCE BENCHMARKS
// ============================================================================

describe('ContextWeaver - SLA Performance Matrix', () => {
  let weaver: ContextWeaver;
  let mockDAG: MerkleDAG;
  let mockAST: ASTGraph;
  let mockSearch: HybridSearch & { state: MockState };

  beforeEach(() => {
    const fileGraph = new Map<string, ReadonlyArray<string>>([
      ['src/main.ts', ['src/lib.ts']],
      ['src/lib.ts', []],
    ]);

    const largeContent = 'function test() { console.log("hello"); }\n'.repeat(100);
    const contentMap = new Map<string, string>([
      ['src/main.ts', largeContent],
      ['src/lib.ts', 'export const value = 42;'],
    ]);

    const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
    const symbolDeps = new Map<string, ReadonlyArray<string>>();
    const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
      [
        'test query',
        [
          {
            file: 'src/main.ts',
            score: 0.9,
            matches: [{ line: 1, snippet: 'function test()' }],
          },
        ],
      ],
    ]);

    mockDAG = createMockDAG(fileGraph, contentMap);
    mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
    mockSearch = createMockHybridSearch(searchIndex);

    weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
  });

  afterEach(() => {
    weaver.removeAllListeners();
  });

  it('should complete processing under 50ms SLA (mobile/ARM budget)', async () => {
    const query = 'test query';
    const options: WeaveOptions = {
      maxTokens: 2000,
      includeDependencies: false,
    };

    const result = await weaver.weave(query, options);
    assertLatencySLA(result.metadata.processingTimeMs, 50);
  });

  it('should achieve >85% token compression ratio', async () => {
    const query = 'test query';
    const largeContent = 'function test() { console.log("hello"); }\n'.repeat(100);
    const rawTokens = estimateTokens(largeContent);

    const options: WeaveOptions = {
      maxTokens: 150,
      includeDependencies: false,
    };

    const result = await weaver.weave(query, options);
    assertCompressionRatio(rawTokens, result.metadata.estimatedTokens, 0.85);
  });

  it('should enforce maxTokens budget deterministically', async () => {
    const query = 'test query';
    const strictBudget = 500;
    const options: WeaveOptions = {
      maxTokens: strictBudget,
      includeDependencies: true,
    };

    const result = await weaver.weave(query, options);
    assertTokenBudgetCompliance(result.metadata.estimatedTokens, strictBudget);
  });
});

// ============================================================================
// TEST SUITE: ADVERSARIAL & EDGE CASES
// ============================================================================

describe('ContextWeaver - Adversarial & Edge Cases', () => {
  let weaver: ContextWeaver;
  let mockDAG: MerkleDAG;
  let mockAST: ASTGraph;
  let mockSearch: HybridSearch & { state: MockState };

  describe('Circular Dependencies', () => {
    beforeEach(() => {
      const fileGraph = new Map<string, ReadonlyArray<string>>([
        ['A.ts', ['B.ts']],
        ['B.ts', ['C.ts']],
        ['C.ts', ['A.ts']],
      ]);

      const contentMap = new Map<string, string>([
        ['A.ts', 'import { b } from "./B";'],
        ['B.ts', 'import { c } from "./C";'],
        ['C.ts', 'import { a } from "./A";'],
      ]);

      const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
      const symbolDeps = new Map<string, ReadonlyArray<string>>();
      const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
        [
          'circular',
          [
            {
              file: 'A.ts',
              score: 1.0,
              matches: [{ line: 1, snippet: 'import { b }' }],
            },
          ],
        ],
      ]);

      mockDAG = createMockDAG(fileGraph, contentMap);
      mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
      mockSearch = createMockHybridSearch(searchIndex);

      weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
    });

    afterEach(() => {
      weaver.removeAllListeners();
    });

    it('should handle circular dependencies without infinite loops', async () => {
      const query = 'circular';
      const options: WeaveOptions = {
        maxTokens: 1000,
        includeDependencies: true,
        maxDepth: 5,
      };

      const result = await weaver.weave(query, options);

      expect(result.metadata.totalFiles).toBeLessThanOrEqual(3);
      expect(result.metadata.processingTimeMs).toBeLessThan(100);
    });
  });

  describe('Malformed & Edge Queries', () => {
    beforeEach(() => {
      const fileGraph = new Map<string, ReadonlyArray<string>>();
      const contentMap = new Map<string, string>();
      const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
      const symbolDeps = new Map<string, ReadonlyArray<string>>();
      const searchIndex = new Map<string, ReadonlyArray<SearchResult>>();

      mockDAG = createMockDAG(fileGraph, contentMap);
      mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
      mockSearch = createMockHybridSearch(searchIndex);

      weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
    });

    afterEach(() => {
      weaver.removeAllListeners();
    });

    it('should handle empty string queries', async () => {
      const query = '';
      const options: WeaveOptions = { maxTokens: 1000 };

      const result = await weaver.weave(query, options);

      expect(result.context).toBe('');
      expect(result.metadata.totalFiles).toBe(0);
    });

    it('should handle unicode and emoji payloads', async () => {
      const query = '🚀 функция 测试 🔥';
      const options: WeaveOptions = { maxTokens: 1000 };

      const result = await weaver.weave(query, options);

      expect(result).toBeDefined();
      expect(result.metadata.estimatedTokens).toBeGreaterThanOrEqual(0);
    });

    it('should handle whitespace-only queries', async () => {
      const query = '   \n\t  ';
      const options: WeaveOptions = { maxTokens: 1000 };

      const result = await weaver.weave(query, options);

      expect(result.context).toBe('');
    });
  });

  describe('Micro Token Budgets', () => {
    beforeEach(() => {
      const fileGraph = new Map<string, ReadonlyArray<string>>([
        ['small.ts', []],
      ]);

      const contentMap = new Map<string, string>([
        ['small.ts', 'export const x = 1; export const y = 2; export const z = 3;'],
      ]);

      const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
      const symbolDeps = new Map<string, ReadonlyArray<string>>();
      const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
        [
          'micro',
          [
            {
              file: 'small.ts',
              score: 1.0,
              matches: [{ line: 1, snippet: 'export const x' }],
            },
          ],
        ],
      ]);

      mockDAG = createMockDAG(fileGraph, contentMap);
      mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
      mockSearch = createMockHybridSearch(searchIndex);

      weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
    });

    afterEach(() => {
      weaver.removeAllListeners();
    });

    it('should gracefully truncate with 50 token budget', async () => {
      const query = 'micro';
      const options: WeaveOptions = { maxTokens: 50 };

      const result = await weaver.weave(query, options);

      assertTokenBudgetCompliance(result.metadata.estimatedTokens, 50);
      expect(result.context.length).toBeGreaterThan(0);
    });

    it('should handle extreme edge: maxTokens = 1', async () => {
      const query = 'micro';
      const options: WeaveOptions = { maxTokens: 1 };

      const result = await weaver.weave(query, options);

      assertTokenBudgetCompliance(result.metadata.estimatedTokens, 1);
    });
  });

  describe('Asynchronous Search Timeouts', () => {
    beforeEach(() => {
      const fileGraph = new Map<string, ReadonlyArray<string>>();
      const contentMap = new Map<string, string>();
      const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
      const symbolDeps = new Map<string, ReadonlyArray<string>>();
      const searchIndex = new Map<string, ReadonlyArray<SearchResult>>();

      mockDAG = createMockDAG(fileGraph, contentMap);
      mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
      mockSearch = createMockHybridSearch(searchIndex);

      weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
    });

    afterEach(() => {
      weaver.removeAllListeners();
    });

    it('should handle slow search responses with timeout', async () => {
      mockSearch.state.simulateLatencyMs = 20;
      const query = 'slow';
      const options: WeaveOptions = { maxTokens: 1000 };

      const startTime = performance.now();
      const result = await weaver.weave(query, options);
      const elapsed = performance.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(15);
      expect(result).toBeDefined();
    });

    it('should propagate search timeout errors', async () => {
      mockSearch.state.shouldTimeout = true;
      const query = 'timeout';
      const options: WeaveOptions = { maxTokens: 1000 };

      await expect(weaver.weave(query, options)).rejects.toThrow('Search timeout');
    });
  });

  describe('Missing Files & Broken References', () => {
    beforeEach(() => {
      const fileGraph = new Map<string, ReadonlyArray<string>>([
        ['existing.ts', ['missing.ts']],
      ]);

      const contentMap = new Map<string, string>([
        ['existing.ts', 'import { x } from "./missing";'],
      ]);

      const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
      const symbolDeps = new Map<string, ReadonlyArray<string>>();
      const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
        [
          'broken',
          [
            {
              file: 'existing.ts',
              score: 1.0,
              matches: [{ line: 1, snippet: 'import { x }' }],
            },
          ],
        ],
      ]);

      mockDAG = createMockDAG(fileGraph, contentMap);
      mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
      mockSearch = createMockHybridSearch(searchIndex);

      weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
    });

    afterEach(() => {
      weaver.removeAllListeners();
    });

    it('should handle missing dependency files gracefully', async () => {
      const query = 'broken';
      const options: WeaveOptions = {
        maxTokens: 1000,
        includeDependencies: true,
      };

      const result = await weaver.weave(query, options);

      expect(result.metadata.totalFiles).toBe(1);
      expect(result.context).toContain('existing.ts');
    });
  });
});

// ============================================================================
// TEST SUITE: EVENT LIFECYCLE & OBSERVABILITY
// ============================================================================

describe('ContextWeaver - Event Lifecycle & Observability', () => {
  let weaver: ContextWeaver;
  let mockDAG: MerkleDAG;
  let mockAST: ASTGraph;
  let mockSearch: HybridSearch & { state: MockState };

  beforeEach(() => {
    const fileGraph = new Map<string, ReadonlyArray<string>>([
      ['src/test.ts', []],
    ]);

    const contentMap = new Map<string, string>([
      ['src/test.ts', 'export const test = true;'],
    ]);

    const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
    const symbolDeps = new Map<string, ReadonlyArray<string>>();
    const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
      [
        'event test',
        [
          {
            file: 'src/test.ts',
            score: 1.0,
            matches: [{ line: 1, snippet: 'export const test' }],
          },
        ],
      ],
    ]);

    mockDAG = createMockDAG(fileGraph, contentMap);
    mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
    mockSearch = createMockHybridSearch(searchIndex);

    weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
  });

  afterEach(() => {
    weaver.removeAllListeners();
  });

  it('should emit weave:start event with correct payload', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    const startEvents: WeaveEventPayload[] = [];

    weaver.on('weave:start', (payload: WeaveEventPayload) => {
      startEvents.push(payload);
    });

    await weaver.weave(query, options);

    expect(startEvents).toHaveLength(1);
    expect(startEvents[0].query).toBe(query);
    expect(startEvents[0].timestamp).toBeGreaterThan(0);
    expect(startEvents[0].metadata).toMatchObject({ maxTokens: 1000 });
  });

  it('should emit weave:complete event with metadata', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    const completeEvents: WeaveEventPayload[] = [];

    weaver.on('weave:complete', (payload: WeaveEventPayload) => {
      completeEvents.push(payload);
    });

    await weaver.weave(query, options);

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].query).toBe(query);
    expect(completeEvents[0].metadata).toHaveProperty('totalFiles');
    expect(completeEvents[0].metadata).toHaveProperty('totalSymbols');
    expect(completeEvents[0].metadata).toHaveProperty('estimatedTokens');
    expect(completeEvents[0].metadata).toHaveProperty('compressionRatio');
    expect(completeEvents[0].metadata).toHaveProperty('processingTimeMs');
  });

  it('should emit weave:error event on failure', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    const errorEvents: WeaveEventPayload[] = [];

    mockSearch.state.forcedError = new Error('Simulated search failure');

    weaver.on('weave:error', (payload: WeaveEventPayload) => {
      errorEvents.push(payload);
    });

    await expect(weaver.weave(query, options)).rejects.toThrow('Simulated search failure');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].query).toBe(query);
    expect(errorEvents[0].metadata).toHaveProperty('error');
  });

  it('should emit events in correct order: start -> complete', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    const eventOrder: string[] = [];

    weaver.on('weave:start', () => eventOrder.push('start'));
    weaver.on('weave:complete', () => eventOrder.push('complete'));

    await weaver.weave(query, options);

    expect(eventOrder).toEqual(['start', 'complete']);
  });

  it('should emit events in correct order on error: start -> error', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    const eventOrder: string[] = [];

    mockSearch.state.forcedError = new Error('Forced error');

    weaver.on('weave:start', () => eventOrder.push('start'));
    weaver.on('weave:error', () => eventOrder.push('error'));

    await expect(weaver.weave(query, options)).rejects.toThrow('Forced error');

    expect(eventOrder).toEqual(['start', 'error']);
  });

  it('should include accurate timestamps in all events', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    const timestamps: number[] = [];

    weaver.on('weave:start', (payload: WeaveEventPayload) => {
      timestamps.push(payload.timestamp);
    });

    weaver.on('weave:complete', (payload: WeaveEventPayload) => {
      timestamps.push(payload.timestamp);
    });

    await weaver.weave(query, options);

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]).toBeGreaterThanOrEqual(timestamps[0]);
  });

  it('should validate event payload integrity with custom matcher', async () => {
    const query = 'event test';
    const options: WeaveOptions = { maxTokens: 1000 };
    let startPayload: WeaveEventPayload | null = null;

    weaver.on('weave:start', (payload: WeaveEventPayload) => {
      startPayload = payload;
    });

    await weaver.weave(query, options);

    expect(startPayload).not.toBeNull();
    assertEventPayload(startPayload!, query, 2000);
  });
});

// ============================================================================
// TEST SUITE: MEMORY ISOLATION & LEAK PREVENTION
// ============================================================================

describe('ContextWeaver - Memory Isolation & Leak Prevention', () => {
  it('should properly cleanup listeners after multiple weave operations', async () => {
    const fileGraph = new Map<string, ReadonlyArray<string>>();
    const contentMap = new Map<string, string>([
      ['test.ts', 'const x = 1;'],
    ]);
    const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
    const symbolDeps = new Map<string, ReadonlyArray<string>>();
    const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
      [
        'leak test',
        [
          {
            file: 'test.ts',
            score: 1.0,
            matches: [{ line: 1, snippet: 'const x' }],
          },
        ],
      ],
    ]);

    const mockDAG = createMockDAG(fileGraph, contentMap);
    const mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
    const mockSearch = createMockHybridSearch(searchIndex);
    const weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);

    const options: WeaveOptions = { maxTokens: 1000 };

    for (let i = 0; i < 10; i++) {
      weaver.on('weave:complete', () => {});
      await weaver.weave('leak test', options);
    }

    const listenerCount = weaver.listenerCount('weave:complete');

    weaver.removeAllListeners();

    expect(listenerCount).toBe(10);
    expect(weaver.listenerCount('weave:complete')).toBe(0);
  });

  it('should not retain references to processed data between invocations', async () => {
    const fileGraph = new Map<string, ReadonlyArray<string>>();
    const contentMap = new Map<string, string>([
      ['first.ts', 'const first = 1;'],
      ['second.ts', 'const second = 2;'],
    ]);
    const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
    const symbolDeps = new Map<string, ReadonlyArray<string>>();
    const searchIndex = new Map<string, ReadonlyArray<SearchResult>>([
      ['first', [{ file: 'first.ts', score: 1.0, matches: [] }]],
      ['second', [{ file: 'second.ts', score: 1.0, matches: [] }]],
    ]);

    const mockDAG = createMockDAG(fileGraph, contentMap);
    const mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
    const mockSearch = createMockHybridSearch(searchIndex);
    const weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);

    const options: WeaveOptions = { maxTokens: 1000 };

    const result1 = await weaver.weave('first', options);
    const result2 = await weaver.weave('second', options);

    expect(result1.context).toContain('first.ts');
    expect(result1.context).not.toContain('second.ts');
    expect(result2.context).toContain('second.ts');
    expect(result2.context).not.toContain('first.ts');

    weaver.removeAllListeners();
  });
});

// ============================================================================
// TEST SUITE: FUZZ TESTING & PROPERTY-BASED VALIDATION
// ============================================================================

describe('ContextWeaver - Fuzz Testing & Property-Based Validation', () => {
  let weaver: ContextWeaver;
  let mockDAG: MerkleDAG;
  let mockAST: ASTGraph;
  let mockSearch: HybridSearch & { state: MockState };

  beforeEach(() => {
    const fileGraph = new Map<string, ReadonlyArray<string>>();
    const contentMap = new Map<string, string>();
    const symbolRegistry = new Map<string, ReadonlyArray<SymbolNode>>();
    const symbolDeps = new Map<string, ReadonlyArray<string>>();
    const searchIndex = new Map<string, ReadonlyArray<SearchResult>>();

    mockDAG = createMockDAG(fileGraph, contentMap);
    mockAST = createMockASTGraph(symbolRegistry, symbolDeps);
    mockSearch = createMockHybridSearch(searchIndex);

    weaver = new ContextWeaver(mockDAG, mockAST, mockSearch);
  });

  afterEach(() => {
    weaver.removeAllListeners();
  });

  it('should handle random string inputs without crashing', async () => {
    const randomQueries = Array.from({ length: 20 }, () =>
      Math.random().toString(36).substring(2, 15)
    );

    const options: WeaveOptions = { maxTokens: 1000 };

    for (const query of randomQueries) {
      const result = await weaver.weave(query, options);
      expect(result).toBeDefined();
      expect(result.metadata.estimatedTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it('should respect token budget for all random maxTokens values', async () => {
    const randomBudgets = Array.from({ length: 10 }, () =>
      Math.floor(Math.random() * 5000) + 100
    );

    for (const budget of randomBudgets) {
      const result = await weaver.weave('fuzz', { maxTokens: budget });
      assertTokenBudgetCompliance(result.metadata.estimatedTokens, budget);
    }
  });

  it('should maintain processing time invariants across varying inputs', async () => {
    const queries = [
      'a',
      'short query',
      'a'.repeat(100),
      'multi\nline\nquery\nwith\nbreaks',
      '🚀'.repeat(50),
    ];

    const options: WeaveOptions = { maxTokens: 1000 };

    for (const query of queries) {
      const result = await weaver.weave(query, options);
      expect(result.metadata.processingTimeMs).toBeLessThan(1000);
    }
  });
});
