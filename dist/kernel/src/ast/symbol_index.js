export class SymbolIndex {
    symbols = new Map();
    graph;
    constructor(graph) {
        this.graph = graph;
    }
    build() {
        this.symbols.clear();
        const allFiles = Array.from(this.getAllFiles());
        for (const filePath of allFiles) {
            const node = this.graph.getFileNode(filePath);
            if (!node)
                continue;
            for (const exp of node.exports) {
                this.addExport(exp, filePath);
            }
            for (const imp of node.imports) {
                this.addImport(imp, filePath);
            }
        }
    }
    getSymbol(name) {
        return this.symbols.get(name);
    }
    findSymbol(pattern) {
        const regex = new RegExp(pattern, 'i');
        const results = [];
        for (const [name, info] of this.symbols.entries()) {
            if (regex.test(name)) {
                results.push(info);
            }
        }
        return results;
    }
    getSymbolUsageCount(name) {
        const info = this.symbols.get(name);
        if (!info)
            return 0;
        return info.importedIn.length + info.exportedFrom.length;
    }
    getUnusedExports() {
        const unused = [];
        for (const [name, info] of this.symbols.entries()) {
            if (info.exportedFrom.length > 0 && info.importedIn.length === 0) {
                for (const exp of info.exportedFrom) {
                    unused.push({ symbol: name, file: exp.filePath });
                }
            }
        }
        return unused;
    }
    getAllSymbols() {
        return Array.from(this.symbols.keys()).sort();
    }
    addExport(exp, filePath) {
        const symbolName = exp.symbol;
        let info = this.symbols.get(symbolName);
        if (!info) {
            info = {
                name: symbolName,
                definedIn: [],
                importedIn: [],
                exportedFrom: [],
            };
            this.symbols.set(symbolName, info);
        }
        if (!info.definedIn.includes(filePath)) {
            info.definedIn.push(filePath);
        }
        info.exportedFrom.push({
            filePath,
            line: exp.line,
            type: 'export',
            isDefault: exp.isDefault,
        });
    }
    addImport(imp, filePath) {
        const symbolName = imp.symbol;
        let info = this.symbols.get(symbolName);
        if (!info) {
            info = {
                name: symbolName,
                definedIn: [],
                importedIn: [],
                exportedFrom: [],
            };
            this.symbols.set(symbolName, info);
        }
        info.importedIn.push({
            filePath,
            line: imp.line,
            type: 'import',
            isDefault: imp.isDefault,
        });
    }
    *getAllFiles() {
        const stats = this.graph.getStats();
        for (let i = 0; i < stats.totalFiles; i++) {
            const node = Array.from(this.graph['nodes'].values())[i];
            if (node)
                yield node.path;
        }
    }
}
