import { FileScanner } from './file_scanner.js';
import { LanguageDetector } from '../parser/language_detector.js';
export class RepositoryIndexer {
    dag;
    depGraph;
    constructor(dag, depGraph) {
        this.dag = dag;
        this.depGraph = depGraph;
    }
    async index(rootPath, options) {
        const startTime = performance.now();
        let filesIndexed = 0;
        let nodesCreated = 0;
        let totalSize = 0;
        const fileMap = new Map();
        for await (const { path, content, metadata } of FileScanner.scan(rootPath, options)) {
            const language = LanguageDetector.detect(path);
            if (language) {
                metadata.language = language;
            }
            const hash = this.dag.add(content, metadata);
            fileMap.set(path, hash);
            const contentStr = Buffer.from(content).toString('utf-8');
            this.depGraph.addFile(path, contentStr);
            filesIndexed++;
            nodesCreated++;
            totalSize += metadata.size;
        }
        for (const [path, hash] of fileMap.entries()) {
            const deps = this.depGraph.getDependencies(path);
            const depHashes = deps
                .map(dep => this.resolveImport(dep, path, fileMap))
                .filter((h) => h !== null);
            if (depHashes.length > 0) {
                const node = this.dag.get(hash);
                if (node) {
                    const updated = this.dag.update(hash, node.data, depHashes);
                    fileMap.set(path, updated);
                }
            }
        }
        const endTime = performance.now();
        return {
            filesIndexed,
            nodesCreated,
            totalSize,
            indexTime: endTime - startTime,
        };
    }
    resolveImport(importPath, fromPath, fileMap) {
        if (importPath.startsWith('.')) {
            const dir = fromPath.substring(0, fromPath.lastIndexOf('/'));
            const resolved = this.normalizePath(join(dir, importPath));
            const candidates = [
                resolved,
                `${resolved}.ts`,
                `${resolved}.js`,
                `${resolved}.tsx`,
                `${resolved}.jsx`,
                `${resolved}/index.ts`,
                `${resolved}/index.js`,
            ];
            for (const candidate of candidates) {
                if (fileMap.has(candidate)) {
                    return fileMap.get(candidate);
                }
            }
        }
        return null;
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
        return normalized.join('/');
    }
}
function join(...paths) {
    return paths.join('/').replace(/\/+/g, '/');
}
