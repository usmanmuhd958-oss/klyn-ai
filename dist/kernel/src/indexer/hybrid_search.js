// kernel/src/indexer/hybrid_search.ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
// ============================================================================
// Ripgrep Executor
// ============================================================================
class RipgrepExecutor {
    ripgrepPath;
    constructor(ripgrepPath = 'rg') {
        this.ripgrepPath = ripgrepPath;
    }
    async search(query, rootPath) {
        return new Promise((resolve, reject) => {
            const args = this.buildArgs(query);
            const results = [];
            const child = spawn(this.ripgrepPath, [...args, query.pattern, rootPath], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0 || code === 1) {
                    // code 1 means no matches, which is not an error
                    const parsed = this.parseRipgrepOutput(stdout);
                    resolve(parsed);
                }
                else {
                    reject(new Error(`Ripgrep failed: ${stderr}`));
                }
            });
            child.on('error', (error) => {
                reject(error);
            });
        });
    }
    buildArgs(query) {
        const args = [
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
        }
        else {
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
    parseRipgrepOutput(output) {
        const results = [];
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
            }
            catch {
                // Skip invalid JSON lines
            }
        }
        return results;
    }
    async isAvailable() {
        return new Promise(resolve => {
            const child = spawn(this.ripgrepPath, ['--version'], {
                stdio: 'ignore',
            });
            child.on('close', (code) => {
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
    dag;
    constructor(dag) {
        this.dag = dag;
    }
    async search(query) {
        const results = [];
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
                    let matches = null;
                    if (pattern) {
                        matches = line.match(pattern);
                    }
                    else {
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
            }
            catch {
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
    config;
    dag;
    astGraph;
    ripgrep;
    nativeSearch;
    ripgrepAvailable = false;
    constructor(dag, astGraph, config) {
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
    async checkRipgrepAvailability() {
        if (this.config.useRipgrep) {
            this.ripgrepAvailable = await this.ripgrep.isAvailable();
            if (this.ripgrepAvailable) {
                this.emit('ripgrep:available');
            }
            else {
                this.emit('ripgrep:unavailable', 'Falling back to native search');
            }
        }
    }
    // ============================================================================
    // Search Methods
    // ============================================================================
    async search(query) {
        const startTime = performance.now();
        let results = [];
        let method = 'native';
        try {
            // Phase 1: Lexical search
            if (this.ripgrepAvailable && this.config.useRipgrep) {
                results = await this.ripgrep.search(query, this.dag['config'].rootPath);
                method = 'ripgrep';
            }
            else {
                results = await this.nativeSearch.search(query);
            }
            // Phase 2: Enhance with AST symbol information
            results = await this.enhanceWithSymbols(results);
            method = 'hybrid';
            const searchTime = performance.now() - startTime;
            const stats = {
                totalMatches: results.length,
                filesSearched: new Set(results.map(r => r.filePath)).size,
                searchTime,
                method,
            };
            this.emit('search:complete', query, stats);
            return { results, stats };
        }
        catch (error) {
            this.emit('search:error', query, error);
            throw error;
        }
    }
    async searchSymbol(symbolName, options = {}) {
        const symbols = this.astGraph.findSymbol(symbolName);
        const results = [];
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
    async searchByRegex(pattern, filePattern) {
        const query = {
            pattern: pattern.source,
            regex: true,
            caseSensitive: !pattern.flags.includes('i'),
            filePattern,
        };
        const { results } = await this.search(query);
        return results;
    }
    async findReferences(symbolName, filePath) {
        // Find all files that import the given file
        const dependents = this.astGraph.getDependents(filePath, 10);
        // Search for the symbol in dependent files
        const results = [];
        for (const dependent of dependents) {
            const query = {
                pattern: symbolName,
                wholeWord: true,
                filePattern: dependent,
            };
            const { results: matches } = await this.search(query);
            results.push(...matches);
        }
        return results;
    }
    async findDefinition(symbolName, fromFile) {
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
    async enhanceWithSymbols(results) {
        const enhanced = [];
        for (const result of results) {
            const symbols = this.astGraph.findSymbolsInFile(result.filePath);
            // Find if the match is a known symbol
            const matchingSymbol = symbols.find(s => s.line === result.line && s.name === result.matchedText);
            if (matchingSymbol) {
                enhanced.push({
                    ...result,
                    type: 'symbol',
                    symbolInfo: matchingSymbol,
                });
            }
            else {
                enhanced.push(result);
            }
        }
        return enhanced;
    }
    // ============================================================================
    // Advanced Queries
    // ============================================================================
    async searchInFiles(pattern, filePaths) {
        const results = [];
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
            }
            catch {
                // Skip files that can't be read
            }
        }
        return results;
    }
    async searchWithContext(query) {
        const { results } = await this.search(query);
        const enhanced = [];
        for (const result of results) {
            try {
                const content = await readFile(result.filePath, 'utf-8');
                const lines = content.split('\n');
                const start = Math.max(0, result.line - this.config.contextLines - 1);
                const end = Math.min(lines.length, result.line + this.config.contextLines);
                const contextLines = lines.slice(start, end);
                enhanced.push({
                    ...result,
                    contextLines,
                });
            }
            catch {
                enhanced.push({ ...result, contextLines: [] });
            }
        }
        return enhanced;
    }
}
export default HybridSearch;
