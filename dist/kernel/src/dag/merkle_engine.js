// kernel/src/dag/merkle_engine.ts
import { createHash } from 'node:crypto';
export class MerkleDAGEngine {
    nodes = new Map();
    pathIndex = new Map();
    add(data, links = [], metadata = {}) {
        const hash = this.computeHash(data, links);
        if (this.nodes.has(hash)) {
            return hash;
        }
        const node = {
            hash,
            data,
            links: [...links].sort(),
            metadata: { ...metadata },
        };
        this.nodes.set(hash, node);
        if (metadata.path) {
            this.pathIndex.set(metadata.path, hash);
        }
        return hash;
    }
    get(hash) {
        return this.nodes.get(hash);
    }
    getByPath(path) {
        const hash = this.pathIndex.get(path);
        return hash ? this.nodes.get(hash) : undefined;
    }
    has(hash) {
        return this.nodes.has(hash);
    }
    delete(hash) {
        const node = this.nodes.get(hash);
        if (!node)
            return false;
        if (node.metadata.path) {
            this.pathIndex.delete(node.metadata.path);
        }
        return this.nodes.delete(hash);
    }
    getLinks(hash) {
        return this.nodes.get(hash)?.links ?? [];
    }
    size() {
        return this.nodes.size;
    }
    clear() {
        this.nodes.clear();
        this.pathIndex.clear();
    }
    *traverse(rootHash, visited = new Set()) {
        if (visited.has(rootHash))
            return;
        const node = this.nodes.get(rootHash);
        if (!node)
            return;
        visited.add(rootHash);
        yield node;
        for (const linkHash of node.links) {
            yield* this.traverse(linkHash, visited);
        }
    }
    computeHash(data, links) {
        const linkStr = links.sort().join(',');
        const combined = Buffer.concat([
            data,
            Buffer.from(linkStr, 'utf-8'),
        ]);
        return createHash('sha256').update(combined).digest('hex');
    }
    getAllHashes() {
        return Array.from(this.nodes.keys());
    }
    exportGraph() {
        return new Map(this.nodes);
    }
    importGraph(nodes) {
        this.clear();
        for (const [hash, node] of nodes.entries()) {
            this.nodes.set(hash, node);
            if (node.metadata.path) {
                this.pathIndex.set(node.metadata.path, hash);
            }
        }
    }
}
