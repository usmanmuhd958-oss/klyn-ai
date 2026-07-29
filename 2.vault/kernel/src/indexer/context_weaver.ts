// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/indexer/context_weaver.ts

import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { ASTGraph, SymbolInfo } from './ast_graph';
import type { HybridSearch, SearchResult } from './hybrid_search';
import type { MerkleDAG } from './merkle_dag';

/**
 * Agent Context Weaver
 * Intelligent context extraction for AI agents
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface ContextRequest {
  task: string;
  focusFiles?: string[];
  keywords?: string[];
  maxTokens?: number;
  includeTests?: boolean;
  includeDependencies?: boolean;
  dependencyDepth?: number;
}

export interface CodeContext {
  id: string;
  task: string;
  relevantFiles: ContextFile[];
  dependencies: string[];
  symbols: SymbolInfo[];
  snippets: CodeSnippet[];
  metadata: ContextMetadata;
  formattedContext: string;
}

export interface ContextFile {
  path: string;
  relevance: number;
  reason: string;
  content?: string;
  symbols: SymbolInfo[];
}

export interface CodeSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  relevance: number;
  symbolName?: string;
  context: string;
}

export interface ContextMetadata {
  totalFiles: number;
  totalSymbols: number;
  totalLines: number;
  estimatedTokens: number;
  processingTime: number;
  dependencyHops: number;
}

export interface WeaverConfig {
  maxTokens: number;
  tokensPerLine: number;
  defaultDependencyDepth: number;
  snippetContextLines: number;
  enableSemanticRanking: boolean;
  compressWhitespace: boolean;
}

// ============================================================================
// Token Estimator
// ============================================================================

class TokenEstimator {
  private tokensPerLine: number;

  constructor(tokensPerLine: number = 4) {
    this.tokensPerLine = tokensPerLine;
  }

  public estimate(text: string): number {
    // Rough estimation: ~4 tokens per line or ~0.75 tokens per word
    const lines = text.split('\n').length;
    const words = text.split(/\s+/).length;
    
    return Math.max(lines * this.tokensPerLine, Math.floor(words * 0.75));
  }

  public estimateLines(lineCount: number): number {
    return lineCount * this.tokensPerLine;
  }
}

// ============================================================================
// Relevance Scorer
// ============================================================================

class RelevanceScorer {
  public scoreFile(
    filePath: string,
    task: string,
    keywords: string[],
    searchResults: SearchResult[]
  ): number {
    let score = 0;

    // Score based on filename matching keywords
    const fileName = filePath.toLowerCase();
    for (const keyword of keywords) {
      if (fileName.includes(keyword.toLowerCase())) {
        score += 10;
      }
    }

    // Score based on search result matches
    const fileMatches = searchResults.filter(r => r.filePath === filePath);
    score += fileMatches.length * 5;

    // Bonus for symbol matches
    const symbolMatches = fileMatches.filter(r => r.type === 'symbol');
    score += symbolMatches.length * 3;

    return score;
  }

  public scoreSnippet(
    snippet: CodeSnippet,
    keywords: string[]
  ): number {
    let score = 0;
    const content = snippet.content.toLowerCase();

    // Score based on keyword presence
    for (const keyword of keywords) {
      if (content.includes(keyword.toLowerCase())) {
        score += 2;
      }
    }

    // Bonus for exported symbols
    if (content.includes('export ')) {
      score += 3;
    }

    // Bonus for class/function definitions
    if (
      content.includes('class ') ||
      content.includes('function ') ||
      content.includes('const ') ||
      content.includes('interface ')
    ) {
      score += 2;
    }

    return score;
  }
}

// ============================================================================
// Context Weaver Implementation
// ============================================================================

export class ContextWeaver extends EventEmitter {
  private config: WeaverConfig;
  private dag: MerkleDAG;
  private astGraph: ASTGraph;
  private search: HybridSearch;
  private tokenEstimator: TokenEstimator;
  private relevanceScorer: RelevanceScorer;

  constructor(
    dag: MerkleDAG,
    astGraph: ASTGraph,
    search: HybridSearch,
    config?: Partial<WeaverConfig>
  ) {
    super();

    this.dag = dag;
    this.astGraph = astGraph;
    this.search = search;

    this.config = {
      maxTokens: config?.maxTokens ?? 8000,
      tokensPerLine: config?.tokensPerLine ?? 4,
      defaultDependencyDepth: config?.defaultDependencyDepth ?? 2,
      snippetContextLines: config?.snippetContextLines ?? 3,
      enableSemanticRanking: config?.enableSemanticRanking ?? true,
      compressWhitespace: config?.compressWhitespace ?? true,
    };

    this.tokenEstimator = new TokenEstimator(this.config.tokensPerLine);
    this.relevanceScorer = new RelevanceScorer();
  }

  // ============================================================================
  // Context Weaving
  // ============================================================================

  public async weaveContext(request: ContextRequest): Promise<CodeContext> {
    const startTime = performance.now();

    this.emit('weave:start', request);

    try {
      // Extract keywords from task
      const keywords = this.extractKeywords(request);

      // Find relevant files
      const relevantFiles = await this.findRelevantFiles(request, keywords);

      // Gather dependencies
      const dependencies = await this.gatherDependencies(
        relevantFiles,
        request.dependencyDepth ?? this.config.defaultDependencyDepth
      );

      // Extract symbols
      const symbols = this.extractSymbols(relevantFiles);

      // Generate snippets
      const snippets = await this.generateSnippets(
        relevantFiles,
        keywords,
        request.maxTokens ?? this.config.maxTokens
      );

      // Format context
      const formattedContext = this.formatContext(
        request.task,
        relevantFiles,
        snippets,
        symbols
      );

      const metadata: ContextMetadata = {
        totalFiles: relevantFiles.length,
        totalSymbols: symbols.length,
        totalLines: snippets.reduce(
          (sum, s) => sum + (s.endLine - s.startLine),
          0
        ),
        estimatedTokens: this.tokenEstimator.estimate(formattedContext),
        processingTime: performance.now() - startTime,
        dependencyHops: request.dependencyDepth ?? this.config.defaultDependencyDepth,
      };

      const context: CodeContext = {
        id: this.generateContextId(),
        task: request.task,
        relevantFiles,
        dependencies,
        symbols,
        snippets,
        metadata,
        formattedContext,
      };

      this.emit('weave:complete', context);

      return context;
    } catch (error) {
      this.emit('weave:error', request, error);
      throw error;
    }
  }

  private extractKeywords(request: ContextRequest): string[] {
    const keywords = request.keywords ?? [];

    // Extract keywords from task using simple heuristics
    const taskWords = request.task
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !this.isStopWord(word));

    // Add focus file names as keywords
    if (request.focusFiles) {
      for (const file of request.focusFiles) {
        const parts = file.split('/');
        const fileName = parts[parts.length - 1].replace(/\.[^.]+$/, '');
        keywords.push(fileName);
      }
    }

    return [...new Set([...keywords, ...taskWords])];
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'from',
      'have',
      'been',
      'will',
    ]);
    return stopWords.has(word);
  }

  private async findRelevantFiles(
    request: ContextRequest,
    keywords: string[]
  ): Promise<ContextFile[]> {
    const relevantFiles = new Map<string, ContextFile>();

    // Add focus files with highest relevance
    if (request.focusFiles) {
      for (const filePath of request.focusFiles) {
        const symbols = this.astGraph.findSymbolsInFile(filePath);
        relevantFiles.set(filePath, {
          path: filePath,
          relevance: 100,
          reason: 'Focus file',
          symbols,
        });
      }
    }

    // Search for files matching keywords
    for (const keyword of keywords) {
      const { results } = await this.search.search({
        pattern: keyword,
        caseSensitive: false,
        maxResults: 50,
      });

      for (const result of results) {
        if (!relevantFiles.has(result.filePath)) {
          const symbols = this.astGraph.findSymbolsInFile(result.filePath);
          const relevance = this.relevanceScorer.scoreFile(
            result.filePath,
            request.task,
            keywords,
            results
          );

          relevantFiles.set(result.filePath, {
            path: result.filePath,
            relevance,
            reason: `Matches keyword: ${keyword}`,
            symbols,
          });
        }
      }
    }

    // Sort by relevance and take top files
    return Array.from(relevantFiles.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 20);
  }

  private async gatherDependencies(
    files: ContextFile[],
    depth: number
  ): Promise<string[]> {
    const dependencies = new Set<string>();

    for (const file of files) {
      const fileDeps = this.astGraph.getDependencies(file.path, depth);
      for (const dep of fileDeps) {
        dependencies.add(dep);
      }
    }

    return Array.from(dependencies);
  }

  private extractSymbols(files: ContextFile[]): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    for (const file of files) {
      symbols.push(...file.symbols);
    }

    return symbols;
  }

  private async generateSnippets(
    files: ContextFile[],
    keywords: string[],
    maxTokens: number
  ): Promise<CodeSnippet[]> {
    const snippets: CodeSnippet[] = [];
    let currentTokens = 0;

    for (const file of files) {
      if (currentTokens >= maxTokens) {
        break;
      }

      try {
        const content = await readFile(file.path, 'utf-8');
        const lines = content.split('\n');

        // Extract snippets around symbols
        for (const symbol of file.symbols) {
          if (currentTokens >= maxTokens) {
            break;
          }

          const startLine = Math.max(
            0,
            symbol.line - this.config.snippetContextLines - 1
          );
          const endLine = Math.min(
            lines.length,
            symbol.line + this.config.snippetContextLines
          );

          const snippetContent = lines.slice(startLine, endLine).join('\n');
          const snippetTokens = this.tokenEstimator.estimate(snippetContent);

          if (currentTokens + snippetTokens <= maxTokens) {
            const snippet: CodeSnippet = {
              filePath: file.path,
              startLine: startLine + 1,
              endLine,
              content: snippetContent,
              relevance: this.relevanceScorer.scoreSnippet(
                { filePath: file.path, startLine, endLine, content: snippetContent, relevance: 0, context: '' },
                keywords
              ),
              symbolName: symbol.name,
              context: symbol.kind,
            };

            snippets.push(snippet);
            currentTokens += snippetTokens;
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Sort by relevance
    return snippets.sort((a, b) => b.relevance - a.relevance);
  }

  private formatContext(
    task: string,
    files: ContextFile[],
    snippets: CodeSnippet[],
    symbols: SymbolInfo[]
  ): string {
    const sections: string[] = [];

    // Task header
    sections.push(`# Task: ${task}\n`);

    // Relevant files
    sections.push(`## Relevant Files (${files.length})`);
    for (const file of files.slice(0, 10)) {
      sections.push(`- ${file.path} (relevance: ${file.relevance})`);
    }
    sections.push('');

    // Key symbols
    const exportedSymbols = symbols.filter(s => s.exported).slice(0, 20);
    if (exportedSymbols.length > 0) {
      sections.push(`## Key Symbols (${exportedSymbols.length})`);
      for (const symbol of exportedSymbols) {
        sections.push(`- **${symbol.name}** (${symbol.kind}) in ${symbol.filePath}:${symbol.line}`);
      }
      sections.push('');
    }

    // Code snippets
    sections.push(`## Relevant Code Snippets (${snippets.length})`);
    for (const snippet of snippets) {
      sections.push(`### ${snippet.filePath}:${snippet.startLine}-${snippet.endLine}`);
      if (snippet.symbolName) {
        sections.push(`Symbol: \`${snippet.symbolName}\` (${snippet.context})`);
      }
      sections.push('```typescript');
      sections.push(snippet.content);
      sections.push('```\n');
    }

    let formatted = sections.join('\n');

    // Compress whitespace if enabled
    if (this.config.compressWhitespace) {
      formatted = formatted.replace(/\n{3,}/g, '\n\n');
    }

    return formatted;
  }

  // ============================================================================
  // Specialized Context Types
  // ============================================================================

  public async weaveBugFixContext(
    errorMessage: string,
    stackTrace: string,
    filePath?: string
  ): Promise<CodeContext> {
    const keywords = this.extractErrorKeywords(errorMessage);

    const request: ContextRequest = {
      task: `Fix bug: ${errorMessage}`,
      focusFiles: filePath ? [filePath] : undefined,
      keywords,
      includeTests: true,
      includeDependencies: true,
      dependencyDepth: 1,
    };

    return this.weaveContext(request);
  }

  public async weaveRefactoringContext(
    targetFile: string,
    targetSymbol?: string
  ): Promise<CodeContext> {
    const dependents = this.astGraph.getDependents(targetFile, 2);

    const request: ContextRequest = {
      task: `Refactor ${targetSymbol ? targetSymbol + ' in ' : ''}${targetFile}`,
      focusFiles: [targetFile, ...Array.from(dependents)],
      keywords: targetSymbol ? [targetSymbol] : [],
      includeDependencies: true,
      dependencyDepth: 2,
    };

    return this.weaveContext(request);
  }

  public async weaveFeatureContext(
    featureDescription: string,
    relatedFiles: string[]
  ): Promise<CodeContext> {
    const request: ContextRequest = {
      task: `Implement feature: ${featureDescription}`,
      focusFiles: relatedFiles,
      includeDependencies: true,
      dependencyDepth: 1,
    };

    return this.weaveContext(request);
  }

  private extractErrorKeywords(errorMessage: string): string[] {
    const keywords: string[] = [];

    // Extract identifiers from error message
    const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const matches = errorMessage.match(identifierPattern);

    if (matches) {
      keywords.push(...matches.filter(m => m.length > 3));
    }

    return [...new Set(keywords)];
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  public estimateTokens(text: string): number {
    return this.tokenEstimator.estimate(text);
  }
}

export default ContextWeaver;
