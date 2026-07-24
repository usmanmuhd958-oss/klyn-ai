import { dirname, extname } from 'node:path';
export class ASTDependencyGraph {
    nodes = new Map();
    pathResolver = new PathResolver();
    rootPath = '';
    async buildFromDAG(dagRoot) {
        this.nodes.clear();
        this.rootPath = dagRoot.path;
        const fileNodes = [];
        this.collectFiles(dagRoot, fileNodes);
        for (const { path, content, language, hash } of fileNodes) {
            const imports = this.parseImports(content, language);
            const exports = this.parseExports(content, language);
            const node = {
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
    getDirectDependencies(filePath) {
        const node = this.nodes.get(filePath);
        if (!node)
            return [];
        return Array.from(node.directDependencies);
    }
    getAffectedFilesOnMutation(filePath) {
        const affected = new Set();
        const visited = new Set();
        const traverse = (path) => {
            if (visited.has(path))
                return;
            visited.add(path);
            const node = this.nodes.get(path);
            if (!node)
                return;
            for (const dependent of node.directDependents) {
                affected.add(dependent);
                traverse(dependent);
            }
        };
        traverse(filePath);
        return Array.from(affected).sort();
    }
    findCircularImports() {
        const cycles = [];
        const visited = new Set();
        const recursionStack = new Set();
        const currentPath = [];
        const dfs = (filePath) => {
            if (recursionStack.has(filePath)) {
                const cycleStart = currentPath.indexOf(filePath);
                if (cycleStart !== -1) {
                    cycles.push([...currentPath.slice(cycleStart), filePath]);
                }
                return true;
            }
            if (visited.has(filePath))
                return false;
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
    getAllDependencies(filePath, maxDepth = Infinity) {
        const dependencies = new Set();
        const visited = new Set();
        const traverse = (path, depth) => {
            if (depth > maxDepth || visited.has(path))
                return;
            visited.add(path);
            const node = this.nodes.get(path);
            if (!node)
                return;
            for (const dep of node.directDependencies) {
                dependencies.add(dep);
                traverse(dep, depth + 1);
            }
        };
        traverse(filePath, 0);
        return dependencies;
    }
    getAllDependents(filePath, maxDepth = Infinity) {
        const dependents = new Set();
        const visited = new Set();
        const traverse = (path, depth) => {
            if (depth > maxDepth || visited.has(path))
                return;
            visited.add(path);
            const node = this.nodes.get(path);
            if (!node)
                return;
            for (const dependent of node.directDependents) {
                dependents.add(dependent);
                traverse(dependent, depth + 1);
            }
        };
        traverse(filePath, 0);
        return dependents;
    }
    getSymbolProviders(symbol) {
        const providers = [];
        for (const [path, node] of this.nodes.entries()) {
            const hasExport = node.exports.some(exp => exp.symbol === symbol || exp.symbol === 'default');
            if (hasExport) {
                providers.push(path);
            }
        }
        return providers;
    }
    getSymbolConsumers(filePath, symbol) {
        const consumers = [];
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
    getFileNode(filePath) {
        return this.nodes.get(filePath);
    }
    topologicalSort() {
        const result = [];
        const visited = new Set();
        const temp = new Set();
        const visit = (path) => {
            if (temp.has(path))
                return false;
            if (visited.has(path))
                return true;
            temp.add(path);
            const node = this.nodes.get(path);
            if (node) {
                for (const dep of node.directDependencies) {
                    if (!visit(dep))
                        return false;
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
            if (circular.has(node.path))
                filesWithCircular++;
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
    collectFiles(node, result) {
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
    parseImports(content, language) {
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
    parseExports(content, language) {
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
    parseJSImports(content) {
        const imports = [];
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
                }
                else if (match[2]) {
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
    parseJSExports(content) {
        const exports = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
            let match;
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
    resolveAllDependencies() {
        const allPaths = this.getAllPaths();
        for (const [filePath, node] of this.nodes.entries()) {
            const fileDir = dirname(filePath);
            for (const imp of node.imports) {
                const resolvedPath = this.pathResolver.resolve(imp.source, fileDir, allPaths);
                if (resolvedPath && this.nodes.has(resolvedPath)) {
                    node.directDependencies.add(resolvedPath);
                    const depNode = this.nodes.get(resolvedPath);
                    depNode.directDependents.add(filePath);
                }
            }
        }
    }
    buildSymbolMaps() {
        for (const [filePath, node] of this.nodes.entries()) {
            const symbolMap = new Map();
            for (const imp of node.imports) {
                const fileDir = dirname(filePath);
                const resolvedPath = this.pathResolver.resolve(imp.source, fileDir, this.getAllPaths());
                if (resolvedPath) {
                    const symbols = symbolMap.get(resolvedPath) || [];
                    if (imp.isNamespace) {
                        symbols.push('*');
                    }
                    else {
                        symbols.push(imp.symbol);
                    }
                    symbolMap.set(resolvedPath, symbols);
                }
            }
            node.symbolMap = symbolMap;
        }
    }
    getAllPaths() {
        return Array.from(this.nodes.keys());
    }
    deduplicateCycles(cycles) {
        const normalized = cycles.map(cycle => {
            const sorted = [...cycle].sort();
            return sorted.join('|');
        });
        const unique = new Set(normalized);
        return Array.from(unique).map(str => str.split('|'));
    }
}
class PathResolver {
    static EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    resolve(importPath, fromDir, allPaths) {
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
    isNodeModule(importPath) {
        return !importPath.startsWith('.') && !importPath.startsWith('/');
    }
    generateCandidates(basePath) {
        const candidates = [];
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
    joinPaths(...parts) {
        const joined = parts.join('/');
        return this.normalizePath(joined);
    }
    normalizePath(path) {
        const parts = path.split('/');
        const normalized = [];
        for (const part of parts) {
            if (part === '..') {
                normalized.pop();
            }
            else if (part !== '.' && part !== '') {
                normalized.push(part);
            }
        }
        return normalized.join('/') || '.';
    }
}
