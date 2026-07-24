// kernel/src/indexer/context_weaver.ts
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
// ============================================================================
// Token Estimator
// ============================================================================
class TokenEstimator {
    tokensPerLine;
    constructor(tokensPerLine = 4) {
        this.tokensPerLine = tokensPerLine;
    }
    estimate(text) {
        // Rough estimation: ~4 tokens per line or ~0.75 tokens per word
        const lines = text.split('\n').length;
        const words = text.split(/\s+/).length;
        return Math.max(lines * this.tokensPerLine, Math.floor(words * 0.75));
    }
    estimateLines(lineCount) {
        return lineCount * this.tokensPerLine;
    }
}
// ============================================================================
// Relevance Scorer
// ============================================================================
class RelevanceScorer {
    scoreFile(filePath, task, keywords, searchResults) {
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
    scoreSnippet(snippet, keywords) {
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
        if (content.includes('class ') ||
            content.includes('function ') ||
            content.includes('const ') ||
            content.includes('interface ')) {
            score += 2;
        }
        return score;
    }
}
// ============================================================================
// Context Weaver Implementation
// ============================================================================
export class ContextWeaver extends EventEmitter {
    config;
    dag;
    astGraph;
    search;
    tokenEstimator;
    relevanceScorer;
    constructor(dag, astGraph, search, config) {
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
    async weaveContext(request) {
        const startTime = performance.now();
        this.emit('weave:start', request);
        try {
            // Extract keywords from task
            const keywords = this.extractKeywords(request);
            // Find relevant files
            const relevantFiles = await this.findRelevantFiles(request, keywords);
            // Gather dependencies
            const dependencies = await this.gatherDependencies(relevantFiles, request.dependencyDepth ?? this.config.defaultDependencyDepth);
            // Extract symbols
            const symbols = this.extractSymbols(relevantFiles);
            // Generate snippets
            const snippets = await this.generateSnippets(relevantFiles, keywords, request.maxTokens ?? this.config.maxTokens);
            // Format context
            const formattedContext = this.formatContext(request.task, relevantFiles, snippets, symbols);
            const metadata = {
                totalFiles: relevantFiles.length,
                totalSymbols: symbols.length,
                totalLines: snippets.reduce((sum, s) => sum + (s.endLine - s.startLine), 0),
                estimatedTokens: this.tokenEstimator.estimate(formattedContext),
                processingTime: performance.now() - startTime,
                dependencyHops: request.dependencyDepth ?? this.config.defaultDependencyDepth,
            };
            const context = {
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
        }
        catch (error) {
            this.emit('weave:error', request, error);
            throw error;
        }
    }
    extractKeywords(request) {
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
    isStopWord(word) {
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
    async findRelevantFiles(request, keywords) {
        const relevantFiles = new Map();
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
                    const relevance = this.relevanceScorer.scoreFile(result.filePath, request.task, keywords, results);
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
    async gatherDependencies(files, depth) {
        const dependencies = new Set();
        for (const file of files) {
            const fileDeps = this.astGraph.getDependencies(file.path, depth);
            for (const dep of fileDeps) {
                dependencies.add(dep);
            }
        }
        return Array.from(dependencies);
    }
    extractSymbols(files) {
        const symbols = [];
        for (const file of files) {
            symbols.push(...file.symbols);
        }
        return symbols;
    }
    async generateSnippets(files, keywords, maxTokens) {
        const snippets = [];
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
                    const startLine = Math.max(0, symbol.line - this.config.snippetContextLines - 1);
                    const endLine = Math.min(lines.length, symbol.line + this.config.snippetContextLines);
                    const snippetContent = lines.slice(startLine, endLine).join('\n');
                    const snippetTokens = this.tokenEstimator.estimate(snippetContent);
                    if (currentTokens + snippetTokens <= maxTokens) {
                        const snippet = {
                            filePath: file.path,
                            startLine: startLine + 1,
                            endLine,
                            content: snippetContent,
                            relevance: this.relevanceScorer.scoreSnippet({ filePath: file.path, startLine, endLine, content: snippetContent, relevance: 0, context: '' }, keywords),
                            symbolName: symbol.name,
                            context: symbol.kind,
                        };
                        snippets.push(snippet);
                        currentTokens += snippetTokens;
                    }
                }
            }
            catch {
                // Skip files that can't be read
            }
        }
        // Sort by relevance
        return snippets.sort((a, b) => b.relevance - a.relevance);
    }
    formatContext(task, files, snippets, symbols) {
        const sections = [];
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
    async weaveBugFixContext(errorMessage, stackTrace, filePath) {
        const keywords = this.extractErrorKeywords(errorMessage);
        const request = {
            task: `Fix bug: ${errorMessage}`,
            focusFiles: filePath ? [filePath] : undefined,
            keywords,
            includeTests: true,
            includeDependencies: true,
            dependencyDepth: 1,
        };
        return this.weaveContext(request);
    }
    async weaveRefactoringContext(targetFile, targetSymbol) {
        const dependents = this.astGraph.getDependents(targetFile, 2);
        const request = {
            task: `Refactor ${targetSymbol ? targetSymbol + ' in ' : ''}${targetFile}`,
            focusFiles: [targetFile, ...Array.from(dependents)],
            keywords: targetSymbol ? [targetSymbol] : [],
            includeDependencies: true,
            dependencyDepth: 2,
        };
        return this.weaveContext(request);
    }
    async weaveFeatureContext(featureDescription, relatedFiles) {
        const request = {
            task: `Implement feature: ${featureDescription}`,
            focusFiles: relatedFiles,
            includeDependencies: true,
            dependencyDepth: 1,
        };
        return this.weaveContext(request);
    }
    extractErrorKeywords(errorMessage) {
        const keywords = [];
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
    generateContextId() {
        return `ctx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
    estimateTokens(text) {
        return this.tokenEstimator.estimate(text);
    }
}
export default ContextWeaver;
