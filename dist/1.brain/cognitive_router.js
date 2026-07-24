export class CognitiveRouter {
    dagRoot;
    depGraph;
    static MAX_CONTEXT_TOKENS = 100000;
    static KEYWORDS = {
        read: ['show', 'get', 'find', 'search', 'display', 'list', 'what', 'where'],
        modify: ['change', 'update', 'edit', 'modify', 'fix', 'patch', 'replace'],
        create: ['create', 'add', 'new', 'generate', 'implement', 'write', 'build'],
        delete: ['delete', 'remove', 'drop', 'clear', 'clean'],
        refactor: ['refactor', 'restructure', 'reorganize', 'optimize', 'improve'],
        analyze: ['analyze', 'explain', 'why', 'how', 'impact', 'dependencies'],
    };
    constructor(dagRoot, depGraph) {
        this.dagRoot = dagRoot;
        this.depGraph = depGraph;
    }
    route(query) {
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
    classifyIntent(query) {
        const normalized = query.toLowerCase();
        const scores = new Map();
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
        let intentType = 'read';
        for (const [type, score] of scores.entries()) {
            if (score > maxScore) {
                maxScore = score;
                intentType = type;
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
    buildContext(query, intent) {
        const relevantFiles = [];
        const dependencies = new Map();
        const symbols = new Map();
        const allFiles = this.collectAllFiles(this.dagRoot);
        for (const file of allFiles) {
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
        const filteredFiles = [];
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
    scoreFileRelevance(file, query, intent) {
        if (file.type !== 'file')
            return 0;
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
            const contentMatches = queryWords.filter(word => word.length > 3 && content.includes(word)).length;
            score += contentMatches * 0.1;
        }
        const ext = file.path.split('.').pop() || '';
        if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
            score += 0.1;
        }
        return Math.min(score, 1.0);
    }
    selectStrategy(intent, context) {
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
    estimateComplexity(intent, context) {
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
    extractFileReferences(query) {
        const files = [];
        const patterns = [
            /([a-zA-Z0-9_\-\/]+\.[a-zA-Z]{2,4})/g,
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
    extractSymbolReferences(query) {
        const symbols = [];
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
    collectAllFiles(node) {
        const files = [];
        if (node.type === 'file') {
            files.push(node);
        }
        for (const child of node.children) {
            files.push(...this.collectAllFiles(child));
        }
        return files;
    }
}
