export class CLICommands {
    engine;
    constructor(engine) {
        this.engine = engine;
    }
    async index(path) {
        console.log(`Indexing repository: ${path}`);
        const startMem = process.memoryUsage().heapUsed;
        const stats = await this.engine.indexRepository(path);
        const endMem = process.memoryUsage().heapUsed;
        const memUsed = (endMem - startMem) / 1024 / 1024;
        console.log(`\n✓ Indexing complete:`);
        console.log(`  Files indexed: ${stats.filesIndexed}`);
        console.log(`  Nodes created: ${stats.nodesCreated}`);
        console.log(`  Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Index time: ${stats.indexTime.toFixed(2)} ms`);
        console.log(`  Memory used: ${memUsed.toFixed(2)} MB`);
        console.log(`  Avg time per file: ${(stats.indexTime / stats.filesIndexed).toFixed(2)} ms`);
    }
    query(path) {
        const result = this.engine.getQueryEngine().findByPath(path);
        if (!result) {
            console.log(`File not found: ${path}`);
            return;
        }
        console.log(`\nFile: ${result.node.metadata.path}`);
        console.log(`Hash: ${result.node.hash}`);
        console.log(`Size: ${result.node.metadata.size} bytes`);
        console.log(`Type: ${result.node.metadata.type}`);
        console.log(`Language: ${result.node.metadata.language || 'unknown'}`);
        if (result.graphNode) {
            console.log(`\nDependencies (${result.graphNode.imports.length}):`);
            result.graphNode.imports.forEach(imp => console.log(`  - ${imp}`));
            console.log(`\nExports (${result.graphNode.exports.length}):`);
            result.graphNode.exports.forEach(exp => console.log(`  - ${exp}`));
        }
    }
    dependencies(path, depth = 1) {
        const deps = this.engine.getQueryEngine().findDependencies(path, depth);
        console.log(`\nDependencies of ${path} (depth=${depth}):`);
        console.log(`Total: ${deps.size}`);
        for (const dep of deps) {
            console.log(`  - ${dep}`);
        }
    }
    impact(path) {
        const analysis = this.engine.getQueryEngine().getImpactAnalysis(path);
        console.log(`\nImpact analysis for: ${path}`);
        console.log(`Direct dependents: ${analysis.directDependents}`);
        console.log(`Total affected files: ${analysis.totalDependents}`);
        if (analysis.affectedFiles.length > 0) {
            console.log(`\nAffected files:`);
            analysis.affectedFiles.slice(0, 20).forEach(file => {
                console.log(`  - ${file}`);
            });
            if (analysis.affectedFiles.length > 20) {
                console.log(`  ... and ${analysis.affectedFiles.length - 20} more`);
            }
        }
    }
    search(pattern, limit = 10) {
        console.log(`Searching for: ${pattern}`);
        const results = this.engine.getQueryEngine().findByContent(pattern);
        console.log(`\nFound ${results.length} matches`);
        results.slice(0, limit).forEach((result, i) => {
            console.log(`\n${i + 1}. ${result.node.metadata.path}`);
            console.log(`   Score: ${result.score.toFixed(6)}`);
            console.log(`   Hash: ${result.node.hash.substring(0, 16)}...`);
        });
    }
    stats() {
        const stats = this.engine.getStats();
        const memUsage = process.memoryUsage();
        console.log(`\nKlyn Engine Statistics:`);
        console.log(`  DAG nodes: ${stats.dagNodes}`);
        console.log(`  Graph nodes: ${stats.graphNodes}`);
        console.log(`  Heap used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Heap total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    }
}
