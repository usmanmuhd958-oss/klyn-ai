import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';
import { RepositoryIndexer } from '../indexer/repository_indexer.js';
import { QueryEngine } from '../query/query_engine.js';
export class KlynEngine {
    dag;
    depGraph;
    indexer;
    query;
    constructor() {
        this.dag = new MerkleDAGEngine();
        this.depGraph = new DependencyGraphBuilder();
        this.indexer = new RepositoryIndexer(this.dag, this.depGraph);
        this.query = new QueryEngine(this.dag, this.depGraph);
    }
    async indexRepository(rootPath, options) {
        return this.indexer.index(rootPath, options);
    }
    getQueryEngine() {
        return this.query;
    }
    getDAG() {
        return this.dag;
    }
    getDependencyGraph() {
        return this.depGraph;
    }
    getStats() {
        return {
            dagNodes: this.dag.size(),
            graphNodes: this.depGraph.size(),
        };
    }
    clear() {
        this.dag.clear();
        this.depGraph.clear();
    }
}
//# sourceMappingURL=klyn_engine.js.map