export class QueryEngine {
    dag;
    depGraph;
    constructor(dag, depGraph) {
        this.dag = dag;
        this.depGraph = depGraph;
    }
    findByPath(path) {
        const node = this.dag.getByPath(path);
        if (!node)
            return null;
        const graphNode = this.depGraph.getNode(path);
        return {
            node,
            graphNode,
            score: 1.0,
        };
    }
    findByHash(hash) {
        const node = this.dag.get(hash);
        if (!node)
            return null;
        const graphNode = this.depGraph.getNode(node.metadata.path);
        return {
            node,
            graphNode,
            score: 1.0,
        };
    }
    findByContent(pattern) {
        const results = [];
        const regex = new RegExp(pattern, 'i');
        for (const hash of this.dag.getAllHashes()) {
            const node = this.dag.get(hash);
            const content = Buffer.from(node.data).toString('utf-8');
            if (regex.test(content)) {
                const graphNode = this.depGraph.getNode(node.metadata.path);
                const matches = content.match(new RegExp(pattern, 'gi'))?.length || 0;
                const score = matches / content.length;
                results.push({ node, graphNode, score });
            }
        }
        return results.sort((a, b) => b.score - a.score);
    }
    findDependencies(path, depth = 1) {
        const visited = new Set();
        const traverse = (currentPath, currentDepth) => {
            if (currentDepth > depth || visited.has(currentPath))
                return;
            visited.add(currentPath);
            const deps = this.depGraph.getDependencies(currentPath);
            for (const dep of deps) {
                traverse(dep, currentDepth + 1);
            }
        };
        traverse(path, 0);
        visited.delete(path);
        return visited;
    }
    findDependents(path, depth = 1) {
        const visited = new Set();
        const traverse = (currentPath, currentDepth) => {
            if (currentDepth > depth || visited.has(currentPath))
                return;
            visited.add(currentPath);
            const dependents = this.depGraph.getDependents(currentPath);
            for (const dependent of dependents) {
                traverse(dependent, currentDepth + 1);
            }
        };
        traverse(path, 0);
        visited.delete(path);
        return visited;
    }
    getImpactAnalysis(path) {
        const directDependents = this.depGraph.getDependents(path);
        const allDependents = this.findDependents(path, 999);
        return {
            directDependents: directDependents.length,
            totalDependents: allDependents.size,
            affectedFiles: Array.from(allDependents),
        };
    }
}
