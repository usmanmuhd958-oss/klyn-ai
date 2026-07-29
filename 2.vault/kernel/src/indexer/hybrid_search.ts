// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/indexer/hybrid_search.ts

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { ASTGraph, SymbolInfo } from './ast_graph';
import type { MerkleDAG } from './merkle_dag';

/**
 * Hybrid Lexical & AST Search Router
 * SIMD-accelerated regex + AST symbol resolution
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface SearchQuery {
  pattern: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  filePattern?: string;
  excludePattern?: string;
  maxResults?: number;
}

export interface SearchResult {
  filePath: string;
  line: number;
  column: number;
  matchedText: string;
  context: string;
  type: 'lexical' | 'symbol';
  symbolInfo?: SymbolInfo;
}

export interface SearchStats {
  totalMatches: number;
  filesSearched: number;
  searchTime: number;
  method: 'ripgrep' | 'native' | 'hybrid';
}

export interface HybridSearchConfig {
  useRipgrep: boolean;
  ripgrepPath: string;
  contextLines: number;
  maxFileSize: number;
  timeout: number;
}

// ============================================================================
// Ripgrep Executor
// ============================================================================

class RipgrepExecutor {
  private ripgrepPath: string;

  constructor(ripgrepPath: string = 'rg') {
    this.ripgrepPath = ripgrepPath;
  }

  public async search(
    query: SearchQuery,
    rootPath: string
  ): Promise<SearchResult[]> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(query);
      const results: SearchResult[] = [];

      const child = spawn(this.ripgrepPath, [...args, query.pattern, rootPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number) => {
        if (code === 0 || code === 1) {
          // code 1 means no matches, which is not an error
          const parsed = this.parseRipgrepOutput(stdout);
          resolve(parsed);
        } else {
          reject(new Error(`Ripgrep failed: ${stderr}`));
        }
      });

      child.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  private buildArgs(query: SearchQuery): string[] {
    const args: string[] = [
      '--json', // JSON output for easy parsing
      '--line-number',
      '--column',
      '--no-heading',
    ];

    if (!query.caseSensitive) {
      args.push('--ignore-case');
    }

    if (query.wholeWord) {
      args.push('--word-regexp');
    }

    if (query.regex) {
      args.push('--regexp');
    } else {
      args.push('--fixed-strings');
    }

    if (query.filePattern) {
      args.push('--glob', query.filePattern);
    }

    if (query.excludePattern) {
      args.push('--glob', `!${query.excludePattern}`);
    }

    if (query.maxResults) {
      args.push('--max-count', query.maxResults.toString());
    }

    return args;
  }

  private parseRipgrepOutput(output: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lines = output.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        if (json.type === 'match') {
          const data = json.data;
          const text = data.lines.text.trim();

          results.push({
            filePath: data.path.text,
            line: data.line_number,
            column: data.submatches[0]?.start || 0,
            matchedText: text,
            context: text,
            type: 'lexical',
          });
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return results;
  }

  public async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const child = spawn(this.ripgrepPath, ['--version'], {
        stdio: 'ignore',
      });

      child.on('close', (code: number) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }
}

// ============================================================================
// Native Search (Fallback)
// ============================================================================

class NativeSearch {
  private dag: MerkleDAG;

  constructor(dag: MerkleDAG) {
    this.dag = dag;
  }

  public async search(query: SearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const files = this.dag.getAllFiles();

    const pattern = query.regex
      ? new RegExp(query.pattern, query.caseSensitive ? 'g' : 'gi')
      : null;

    for (const node of files) {
      try {
        const content = await readFile(node.path, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let matches: RegExpMatchArray | null = null;

          if (pattern) {
            matches = line.match(pattern);
          } else {
            const searchText = query.caseSensitive
              ? line
              : line.toLowerCase();
            const searchPattern = query.caseSensitive
              ? query.pattern
              : query.pattern.toLowerCase();

            if (searchText.includes(searchPattern)) {
              matches = [searchPattern];
            }
          }

          if (matches) {
            for (const match of matches) {
              const column = line.indexOf(match);

              results.push({
                filePath: node.path,
                line: i + 1,
                column: column + 1,
                matchedText: match,
                context: line.trim(),
                type: 'lexical',
              });

              if (query.maxResults && results.length >= query.maxResults) {
                return results;
              }
            }
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }
}

// ============================================================================
// Hybrid Search Implementation
// ============================================================================

export class HybridSearch extends EventEmitter {
  private config: HybridSearchConfig;
  private dag: MerkleDAG;
  private astGraph: ASTGraph;
  private ripgrep: RipgrepExecutor;
  private nativeSearch: NativeSearch;
  private ripgrepAvailable: boolean = false;

  constructor(
    dag: MerkleDAG,
    astGraph: ASTGraph,
    config?: Partial<HybridSearchConfig>
  ) {
    super();

    this.dag = dag;
    this.astGraph = astGraph;

    this.config = {
      useRipgrep: config?.useRipgrep ?? true,
      ripgrepPath: config?.ripgrepPath ?? 'rg',
      contextLines: config?.contextLines ?? 2,
      maxFileSize: config?.maxFileSize ?? 1024 * 1024,
      timeout: config?.timeout ?? 30000,
    };

    this.ripgrep = new RipgrepExecutor(this.config.ripgrepPath);
    this.nativeSearch = new NativeSearch(dag);

    this.checkRipgrepAvailability();
  }

  private async checkRipgrepAvailability(): Promise<void> {
    if (this.config.useRipgrep) {
      this.ripgrepAvailable = await this.ripgrep.isAvailable();
      
      if (this.ripgrepAvailable) {
        this.emit('ripgrep:available');
      } else {
        this.emit('ripgrep:unavailable', 'Falling back to native search');
      }
    }
  }

  // ============================================================================
  // Search Methods
  // ============================================================================

  public async search(query: SearchQuery): Promise<{
    results: SearchResult[];
    stats: SearchStats;
  }> {
    const startTime = performance.now();
    let results: SearchResult[] = [];
    let method: SearchStats['method'] = 'native';

    try {
      // Phase 1: Lexical search
      if (this.ripgrepAvailable && this.config.useRipgrep) {
        results = await this.ripgrep.search(query, this.dag['config'].rootPath);
        method = 'ripgrep';
      } else {
        results = await this.nativeSearch.search(query);
      }

      // Phase 2: Enhance with AST symbol information
      results = await this.enhanceWithSymbols(results);
      method = 'hybrid';

      const searchTime = performance.now() - startTime;

      const stats: SearchStats = {
        totalMatches: results.length,
        filesSearched: new Set(results.map(r => r.filePath)).size,
        searchTime,
        method,
      };

      this.emit('search:complete', query, stats);

      return { results, stats };
    } catch (error) {
      this.emit('search:error', query, error);
      throw error;
    }
  }

  public async searchSymbol(
    symbolName: string,
    options: {
      exported?: boolean;
      kind?: string;
    } = {}
  ): Promise<SearchResult[]> {
    const symbols = this.astGraph.findSymbol(symbolName);
    const results: SearchResult[] = [];

    for (const symbol of symbols) {
      if (options.exported !== undefined && symbol.exported !== options.exported) {
        continue;
      }

      if (options.kind && symbol.kind !== options.kind) {
        continue;
      }

      results.push({
        filePath: symbol.filePath,
        line: symbol.line,
        column: symbol.column,
        matchedText: symbol.name,
        context: symbol.signature || symbol.name,
        type: 'symbol',
        symbolInfo: symbol,
      });
    }

    return results;
  }

  public async searchByRegex(
    pattern: RegExp,
    filePattern?: string
  ): Promise<SearchResult[]> {
    const query: SearchQuery = {
      pattern: pattern.source,
      regex: true,
      caseSensitive: !pattern.flags.includes('i'),
      filePattern,
    };

    const { results } = await this.search(query);
    return results;
  }

  public async findReferences(
    symbolName: string,
    filePath: string
  ): Promise<SearchResult[]> {
    // Find all files that import the given file
    const dependents = this.astGraph.getDependents(filePath, 10);

    // Search for the symbol in dependent files
    const results: SearchResult[] = [];

    for (const dependent of dependents) {
      const query: SearchQuery = {
        pattern: symbolName,
        wholeWord: true,
        filePattern: dependent,
      };

      const { results: matches } = await this.search(query);
      results.push(...matches);
    }

    return results;
  }

  public async findDefinition(
    symbolName: string,
    fromFile: string
  ): Promise<SearchResult | null> {
    // Get imports from the file
    const metadata = this.astGraph.getFileMetadata(fromFile);
    
    if (!metadata) {
      return null;
    }

    // Search in imported files
    for (const importInfo of metadata.imports) {
      if (importInfo.symbols.includes(symbolName)) {
        // Search for the symbol definition in the imported file
        const symbols = this.astGraph.findExportedSymbols(importInfo.importedFrom);
        
        for (const symbol of symbols) {
          if (symbol.name === symbolName) {
            return {
              filePath: symbol.filePath,
              line: symbol.line,
              column: symbol.column,
              matchedText: symbol.name,
              context: symbol.signature || symbol.name,
              type: 'symbol',
              symbolInfo: symbol,
            };
          }
        }
      }
    }

    return null;
  }

  private async enhanceWithSymbols(
    results: SearchResult[]
  ): Promise<SearchResult[]> {
    const enhanced: SearchResult[] = [];

    for (const result of results) {
      const symbols = this.astGraph.findSymbolsInFile(result.filePath);
      
      // Find if the match is a known symbol
      const matchingSymbol = symbols.find(
        s => s.line === result.line && s.name === result.matchedText
      );

      if (matchingSymbol) {
        enhanced.push({
          ...result,
          type: 'symbol',
          symbolInfo: matchingSymbol,
        });
      } else {
        enhanced.push(result);
      }
    }

    return enhanced;
  }

  // ============================================================================
  // Advanced Queries
  // ============================================================================

  public async searchInFiles(
    pattern: string,
    filePaths: string[]
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const filePath of filePaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(pattern)) {
            const column = lines[i].indexOf(pattern);

            results.push({
              filePath,
              line: i + 1,
              column: column + 1,
              matchedText: pattern,
              context: lines[i].trim(),
              type: 'lexical',
            });
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  public async searchWithContext(
    query: SearchQuery
  ): Promise<Array<SearchResult & { contextLines: string[] }>> {
    const { results } = await this.search(query);
    const enhanced: Array<SearchResult & { contextLines: string[] }> = [];

    for (const result of results) {
      try {
        const content = await readFile(result.filePath, 'utf-8');
        const lines = content.split('\n');

        const start = Math.max(0, result.line - this.config.contextLines - 1);
        const end = Math.min(
          lines.length,
          result.line + this.config.contextLines
        );

        const contextLines = lines.slice(start, end);

        enhanced.push({
          ...result,
          contextLines,
        });
      } catch {
        enhanced.push({ ...result, contextLines: [] });
      }
    }

    return enhanced;
  }
}

export default HybridSearch;
