// FILE: kernel/src/ast/context_graph.ts
class ASTContextGraphEngine {
    estimatedTokensPerLine;
    constructor(estimatedTokensPerLine = 4) {
        this.estimatedTokensPerLine = estimatedTokensPerLine;
    }
    buildGraph(files) {
        const nodes = new Map();
        const fileSymbols = new Map();
        const reverseImports = new Map();
        for (const [filePath, content] of files.entries()) {
            const symbols = this.parseFile(filePath, content);
            const symbolNames = [];
            for (const symbol of symbols) {
                const key = this.getSymbolKey(symbol.name, filePath);
                nodes.set(key, symbol);
                symbolNames.push(key);
                for (const dep of symbol.dependencies) {
                    if (!reverseImports.has(dep)) {
                        reverseImports.set(dep, new Set());
                    }
                    reverseImports.get(dep).add(key);
                }
            }
            fileSymbols.set(filePath, symbolNames);
        }
        this.linkDependents(nodes);
        return { nodes, fileSymbols, reverseImports };
    }
    resolveContextForSymbol(symbolName, maxTokenBudget, graph) {
        const primarySymbol = this.findSymbol(symbolName, graph);
        if (!primarySymbol) {
            return {
                primarySymbol: null,
                dependencies: [],
                tokensUsed: 0,
                includedSymbols: [],
                excludedSymbols: [],
            };
        }
        const visited = new Set();
        const dependencies = [];
        const included = [primarySymbol.name];
        const excluded = [];
        let tokensUsed = this.estimateTokens(primarySymbol.sourceCode);
        const queue = [...primarySymbol.dependencies];
        while (queue.length > 0) {
            const depName = queue.shift();
            if (visited.has(depName)) {
                continue;
            }
            visited.add(depName);
            const depSymbol = this.findSymbol(depName, graph);
            if (!depSymbol) {
                continue;
            }
            const depTokens = this.estimateTokens(depSymbol.sourceCode);
            if (tokensUsed + depTokens <= maxTokenBudget) {
                dependencies.push(depSymbol);
                included.push(depSymbol.name);
                tokensUsed += depTokens;
                for (const transitiveDep of depSymbol.dependencies) {
                    if (!visited.has(transitiveDep)) {
                        queue.push(transitiveDep);
                    }
                }
            }
            else {
                excluded.push(depSymbol.name);
            }
        }
        return {
            primarySymbol,
            dependencies,
            tokensUsed,
            includedSymbols: included,
            excludedSymbols: excluded,
        };
    }
    parseFile(filePath, content) {
        const symbols = [];
        const lines = content.split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            if (this.isComment(line) || line.length === 0) {
                i++;
                continue;
            }
            const classMatch = this.matchClass(line);
            if (classMatch) {
                const symbol = this.parseClass(lines, i, filePath, classMatch);
                symbols.push(symbol);
                i = symbol.endLine;
                continue;
            }
            const interfaceMatch = this.matchInterface(line);
            if (interfaceMatch) {
                const symbol = this.parseInterface(lines, i, filePath, interfaceMatch);
                symbols.push(symbol);
                i = symbol.endLine;
                continue;
            }
            const typeMatch = this.matchType(line);
            if (typeMatch) {
                const symbol = this.parseType(lines, i, filePath, typeMatch);
                symbols.push(symbol);
                i = symbol.endLine;
                continue;
            }
            const functionMatch = this.matchFunction(line);
            if (functionMatch) {
                const symbol = this.parseFunction(lines, i, filePath, functionMatch);
                symbols.push(symbol);
                i = symbol.endLine;
                continue;
            }
            const arrowMatch = this.matchArrowFunction(line);
            if (arrowMatch) {
                const symbol = this.parseArrowFunction(lines, i, filePath, arrowMatch);
                symbols.push(symbol);
                i = symbol.endLine;
                continue;
            }
            i++;
        }
        return symbols;
    }
    matchClass(line) {
        return line.match(/^(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/);
    }
    matchInterface(line) {
        return line.match(/^(export\s+)?interface\s+(\w+)/);
    }
    matchType(line) {
        return line.match(/^(export\s+)?type\s+(\w+)/);
    }
    matchFunction(line) {
        return line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
    }
    matchArrowFunction(line) {
        return line.match(/^(export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/);
    }
    parseClass(lines, startLine, filePath, match) {
        const isExported = !!match[1];
        const isDefault = !!match[2];
        const className = match[4];
        const endLine = this.findBlockEnd(lines, startLine);
        const sourceCode = lines.slice(startLine, endLine + 1).join('\n');
        const extendsMatch = sourceCode.match(/extends\s+([\w<>,\s]+?)(?:\s+implements|\s*\{)/);
        const implementsMatch = sourceCode.match(/implements\s+([\w<>,\s]+?)\s*\{/);
        const extendsClasses = extendsMatch
            ? extendsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
            : [];
        const implementsInterfaces = implementsMatch
            ? implementsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
            : [];
        const typeParams = this.extractTypeParameters(sourceCode);
        const dependencies = this.extractDependencies(sourceCode);
        dependencies.push(...extendsClasses, ...implementsInterfaces);
        return {
            name: className,
            type: 'class',
            filePath,
            startLine,
            endLine,
            sourceCode,
            dependencies: Array.from(new Set(dependencies)),
            dependents: [],
            metadata: {
                isExported,
                isDefault,
                extends: extendsClasses,
                implements: implementsInterfaces,
                typeParameters: typeParams,
            },
        };
    }
    parseInterface(lines, startLine, filePath, match) {
        const isExported = !!match[1];
        const interfaceName = match[2];
        const endLine = this.findBlockEnd(lines, startLine);
        const sourceCode = lines.slice(startLine, endLine + 1).join('\n');
        const extendsMatch = sourceCode.match(/extends\s+([\w<>,\s]+?)\s*\{/);
        const extendsInterfaces = extendsMatch
            ? extendsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
            : [];
        const typeParams = this.extractTypeParameters(sourceCode);
        const dependencies = this.extractDependencies(sourceCode);
        dependencies.push(...extendsInterfaces);
        return {
            name: interfaceName,
            type: 'interface',
            filePath,
            startLine,
            endLine,
            sourceCode,
            dependencies: Array.from(new Set(dependencies)),
            dependents: [],
            metadata: {
                isExported,
                isDefault: false,
                extends: extendsInterfaces,
                implements: [],
                typeParameters: typeParams,
            },
        };
    }
    parseType(lines, startLine, filePath, match) {
        const isExported = !!match[1];
        const typeName = match[2];
        const endLine = this.findStatementEnd(lines, startLine);
        const sourceCode = lines.slice(startLine, endLine + 1).join('\n');
        const typeParams = this.extractTypeParameters(sourceCode);
        const dependencies = this.extractDependencies(sourceCode);
        return {
            name: typeName,
            type: 'type',
            filePath,
            startLine,
            endLine,
            sourceCode,
            dependencies: Array.from(new Set(dependencies)),
            dependents: [],
            metadata: {
                isExported,
                isDefault: false,
                extends: [],
                implements: [],
                typeParameters: typeParams,
            },
        };
    }
    parseFunction(lines, startLine, filePath, match) {
        const isExported = !!match[1];
        const functionName = match[3];
        const endLine = this.findBlockEnd(lines, startLine);
        const sourceCode = lines.slice(startLine, endLine + 1).join('\n');
        const dependencies = this.extractDependencies(sourceCode);
        return {
            name: functionName,
            type: 'function',
            filePath,
            startLine,
            endLine,
            sourceCode,
            dependencies: Array.from(new Set(dependencies)),
            dependents: [],
            metadata: {
                isExported,
                isDefault: false,
                extends: [],
                implements: [],
                typeParameters: [],
            },
        };
    }
    parseArrowFunction(lines, startLine, filePath, match) {
        const isExported = !!match[1];
        const functionName = match[2];
        const endLine = this.findStatementEnd(lines, startLine);
        const sourceCode = lines.slice(startLine, endLine + 1).join('\n');
        const dependencies = this.extractDependencies(sourceCode);
        return {
            name: functionName,
            type: 'function',
            filePath,
            startLine,
            endLine,
            sourceCode,
            dependencies: Array.from(new Set(dependencies)),
            dependents: [],
            metadata: {
                isExported,
                isDefault: false,
                extends: [],
                implements: [],
                typeParameters: [],
            },
        };
    }
    findBlockEnd(lines, startLine) {
        let braceCount = 0;
        let foundOpen = false;
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    foundOpen = true;
                }
                else if (char === '}') {
                    braceCount--;
                    if (foundOpen && braceCount === 0) {
                        return i;
                    }
                }
            }
        }
        return startLine;
    }
    findStatementEnd(lines, startLine) {
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.endsWith(';') || line.endsWith('}')) {
                return i;
            }
        }
        return startLine;
    }
    extractTypeParameters(sourceCode) {
        const match = sourceCode.match(/<([^>]+)>/);
        if (!match)
            return [];
        return match[1]
            .split(',')
            .map(p => p.trim().split(/\s+/)[0])
            .filter(Boolean);
    }
    extractDependencies(sourceCode) {
        const dependencies = new Set();
        const importMatches = sourceCode.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from/g);
        for (const match of importMatches) {
            if (match[1]) {
                const symbols = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
                symbols.forEach(s => dependencies.add(s));
            }
            else if (match[2]) {
                dependencies.add(match[2]);
            }
        }
        const typeRefs = sourceCode.matchAll(/:\s*([A-Z]\w+)/g);
        for (const match of typeRefs) {
            dependencies.add(match[1]);
        }
        const functionCalls = sourceCode.matchAll(/\b([a-z]\w+)\s*\(/g);
        for (const match of functionCalls) {
            const name = match[1];
            if (!this.isKeyword(name)) {
                dependencies.add(name);
            }
        }
        const newExpressions = sourceCode.matchAll(/new\s+([A-Z]\w+)/g);
        for (const match of newExpressions) {
            dependencies.add(match[1]);
        }
        return Array.from(dependencies);
    }
    isKeyword(word) {
        const keywords = new Set([
            'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
            'continue', 'return', 'throw', 'try', 'catch', 'finally',
            'const', 'let', 'var', 'function', 'class', 'interface', 'type',
            'async', 'await', 'yield', 'import', 'export', 'default',
        ]);
        return keywords.has(word);
    }
    isComment(line) {
        return line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');
    }
    linkDependents(nodes) {
        for (const [key, node] of nodes.entries()) {
            for (const dep of node.dependencies) {
                const depNode = this.findSymbolInMap(dep, nodes);
                if (depNode && !depNode.dependents.includes(node.name)) {
                    depNode.dependents.push(node.name);
                }
            }
        }
    }
    findSymbol(symbolName, graph) {
        for (const [key, node] of graph.nodes.entries()) {
            if (node.name === symbolName) {
                return node;
            }
        }
        return null;
    }
    findSymbolInMap(symbolName, nodes) {
        for (const [key, node] of nodes.entries()) {
            if (node.name === symbolName) {
                return node;
            }
        }
        return null;
    }
    getSymbolKey(name, filePath) {
        return `${filePath}::${name}`;
    }
    estimateTokens(sourceCode) {
        const lines = sourceCode.split('\n').length;
        return lines * this.estimatedTokensPerLine;
    }
}
export { ASTContextGraphEngine };
