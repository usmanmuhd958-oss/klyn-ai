export class ASTParser {
    static IMPORT_PATTERNS = {
        typescript: [
            /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /export\s+(?:{[^}]+}|\*)\s+from\s+['"]([^'"]+)['"]/g,
        ],
        javascript: [
            /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ],
        python: [
            /^import\s+([\w.]+)/gm,
            /^from\s+([\w.]+)\s+import/gm,
        ],
        go: [
            /import\s+\"([^\"]+)\"/g,
            /import\s+\(\s*([^)]+)\)/gs,
        ],
    };
    static EXPORT_PATTERNS = {
        typescript: [
            /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
            /export\s+default\s+(\w+)/g,
            /export\s+{([^}]+)}/g,
        ],
        javascript: [
            /export\s+(?:const|let|var|function|class)\s+(\w+)/g,
            /export\s+default\s+(\w+)/g,
            /module\.exports\s*=\s*{([^}]+)}/g,
        ],
    };
    static parse(content, language, filePath) {
        const imports = this.extractImports(content, language);
        const exports = this.extractExports(content, language);
        const rootNode = {
            id: filePath,
            type: 'module',
            name: filePath.split('/').pop() || filePath,
            range: [0, content.length],
            dependencies: imports,
            exports,
        };
        return [rootNode];
    }
    static extractImports(content, language) {
        const patterns = this.IMPORT_PATTERNS[language] || [];
        const imports = new Set();
        for (const pattern of patterns) {
            const regex = new RegExp(pattern.source, pattern.flags);
            let match;
            while ((match = regex.exec(content)) !== null) {
                if (match[1]) {
                    const importPath = match[1].trim();
                    if (importPath.includes('\n')) {
                        importPath.split(/[\n,]/).forEach(p => {
                            const clean = p.trim().replace(/["']/g, '');
                            if (clean)
                                imports.add(clean);
                        });
                    }
                    else {
                        imports.add(importPath);
                    }
                }
            }
        }
        return Array.from(imports);
    }
    static extractExports(content, language) {
        const patterns = this.EXPORT_PATTERNS[language] || [];
        const exports = new Set();
        for (const pattern of patterns) {
            const regex = new RegExp(pattern.source, pattern.flags);
            let match;
            while ((match = regex.exec(content)) !== null) {
                if (match[1]) {
                    const exportName = match[1].trim();
                    if (exportName.includes(',')) {
                        exportName.split(',').forEach(e => exports.add(e.trim()));
                    }
                    else {
                        exports.add(exportName);
                    }
                }
            }
        }
        return Array.from(exports);
    }
}
