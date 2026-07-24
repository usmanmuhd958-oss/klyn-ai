import { ASTParser } from '../parser/ast_parser.js';
import { LanguageDetector } from '../parser/language_detector.js';
import { HashEngine } from '../core/hash.js';
export class DependencyGraphBuilder {
    graph = {
        nodes: new Map(),
        edges: new Map(),
    };
    addFile(path, content) {
        const language = LanguageDetector.detect(path);
        const hash = HashEngine.hash(content);
        const astNodes = language
            ? ASTParser.parse(content, language, path)
            : [];
        const imports = astNodes.flatMap(n => n.dependencies);
        const exports = astNodes.flatMap(n => n.exports);
        const node = {
            path,
            hash,
            imports,
            exports,
            astNodes,
        };
        this.graph.nodes.set(path, node);
        this.graph.edges.set(path, new Set(imports));
        return hash;
    }
    getDependencies(path) {
        return Array.from(this.graph.edges.get(path) || []);
    }
    getDependents(path) {
        const dependents = [];
        for (const [nodePath, deps] of this.graph.edges.entries()) {
            if (deps.has(path)) {
                dependents.push(nodePath);
            }
        }
        return dependents;
    }
    getNode(path) {
        return this.graph.nodes.get(path);
    }
    hasCircularDependency(path) {
        const visited = new Set();
        const stack = new Set();
        const dfs = (current) => {
            if (stack.has(current))
                return true;
            if (visited.has(current))
                return false;
            visited.add(current);
            stack.add(current);
            const deps = this.graph.edges.get(current) || new Set();
            for (const dep of deps) {
                if (dfs(dep))
                    return true;
            }
            stack.delete(current);
            return false;
        };
        return dfs(path);
    }
    topologicalSort() {
        const visited = new Set();
        const result = [];
        const dfs = (node) => {
            if (visited.has(node))
                return;
            visited.add(node);
            const deps = this.graph.edges.get(node) || new Set();
            for (const dep of deps) {
                if (this.graph.nodes.has(dep)) {
                    dfs(dep);
                }
            }
            result.push(node);
        };
        for (const node of this.graph.nodes.keys()) {
            dfs(node);
        }
        return result.reverse();
    }
    getGraph() {
        return this.graph;
    }
    clear() {
        this.graph.nodes.clear();
        this.graph.edges.clear();
    }
    size() {
        return this.graph.nodes.size;
    }
}
