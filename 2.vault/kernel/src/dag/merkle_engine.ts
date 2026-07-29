// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/dag/merkle_engine.ts
import { createHash } from 'node:crypto';

export interface MerkleDAGNode {
  hash: string;
  data: Uint8Array;
  links: string[];
  metadata: Record<string, any>;
}

export class MerkleDAGEngine {
  private nodes: Map<string, MerkleDAGNode> = new Map();
  private pathIndex: Map<string, string> = new Map();

  add(data: Uint8Array, links: string[] = [], metadata: Record<string, any> = {}): string {
    const hash = this.computeHash(data, links);
    
    if (this.nodes.has(hash)) {
      return hash;
    }

    const node: MerkleDAGNode = {
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

  get(hash: string): MerkleDAGNode | undefined {
    return this.nodes.get(hash);
  }

  getByPath(path: string): MerkleDAGNode | undefined {
    const hash = this.pathIndex.get(path);
    return hash ? this.nodes.get(hash) : undefined;
  }

  has(hash: string): boolean {
    return this.nodes.has(hash);
  }

  delete(hash: string): boolean {
    const node = this.nodes.get(hash);
    if (!node) return false;

    if (node.metadata.path) {
      this.pathIndex.delete(node.metadata.path);
    }

    return this.nodes.delete(hash);
  }

  getLinks(hash: string): string[] {
    return this.nodes.get(hash)?.links ?? [];
  }

  size(): number {
    return this.nodes.size;
  }

  clear(): void {
    this.nodes.clear();
    this.pathIndex.clear();
  }

  *traverse(rootHash: string, visited: Set<string> = new Set()): Generator<MerkleDAGNode> {
    if (visited.has(rootHash)) return;

    const node = this.nodes.get(rootHash);
    if (!node) return;

    visited.add(rootHash);
    yield node;

    for (const linkHash of node.links) {
      yield* this.traverse(linkHash, visited);
    }
  }

  private computeHash(data: Uint8Array, links: string[]): string {
    const linkStr = links.sort().join(',');
    const combined = Buffer.concat([
      data,
      Buffer.from(linkStr, 'utf-8'),
    ]);

    return createHash('sha256').update(combined).digest('hex');
  }

  getAllHashes(): string[] {
    return Array.from(this.nodes.keys());
  }

  exportGraph(): Map<string, MerkleDAGNode> {
    return new Map(this.nodes);
  }

  importGraph(nodes: Map<string, MerkleDAGNode>): void {
    this.clear();
    for (const [hash, node] of nodes.entries()) {
      this.nodes.set(hash, node);
      if (node.metadata.path) {
        this.pathIndex.set(node.metadata.path, hash);
      }
    }
  }
}
