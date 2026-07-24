import { HashEngine } from './hash.js';
export class MerkleDAGEngine {
    nodes = new Map();
    pathToHash = new Map();
    add(data, metadata, links = []) {
        const contentStr = Buffer.from(data).toString('utf-8');
        const hash = HashEngine.contentHash(contentStr, links);
        if (this.nodes.has(hash)) {
            this.pathToHash.set(metadata.path, hash);
            return hash;
        }
        const node = {
            hash,
            data,
            links: [...links].sort(),
            metadata: { ...metadata }
        };
        this.nodes.set(hash, node);
        this.pathToHash.set(metadata.path, hash);
        return hash;
    }
    get(hash) {
        return this.nodes.get(hash);
    }
    getByPath(path) {
        const hash = this.pathToHash.get(path);
        return hash ? this.nodes.get(hash) : undefined;
    }
    has(hash) {
        return this.nodes.has(hash);
    }
    update(oldHash, data, links) {
        const oldNode = this.nodes.get(oldHash);
        if (!oldNode)
            throw new Error(`Node ${oldHash} not found`);
        this.nodes.delete(oldHash);
        this.pathToHash.delete(oldNode.metadata.path);
        return this.add(data, oldNode.metadata, links);
    }
    getLinks(hash) {
        return this.nodes.get(hash)?.links ?? [];
    }
    size() {
        return this.nodes.size;
    }
    clear() {
        this.nodes.clear();
        this.pathToHash.clear();
    }
    getAllHashes() {
        return Array.from(this.nodes.keys());
    }
    *traverse(rootHash) {
        const visited = new Set();
        const queue = [rootHash];
        while (queue.length > 0) {
            const hash = queue.shift();
            if (visited.has(hash))
                continue;
            visited.add(hash);
            const node = this.nodes.get(hash);
            if (node) {
                yield node;
                queue.push(...node.links);
            }
        }
    }
}
//# sourceMappingURL=merkle_dag.js.map