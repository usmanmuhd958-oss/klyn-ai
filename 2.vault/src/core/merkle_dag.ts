// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// src/core/merkle_dag.ts
import type { MerkleNode, NodeMetadata } from '../types/core.js';
import { HashEngine } from './hash.js';

export class MerkleDAGEngine {
  private nodes: Map<string, MerkleNode> = new Map();
  private pathToHash: Map<string, string> = new Map();
  
  add(data: Uint8Array, metadata: NodeMetadata, links: string[] = []): string {
    const contentStr = Buffer.from(data).toString('utf-8');
    const hash = HashEngine.contentHash(contentStr, links);
    
    if (this.nodes.has(hash)) {
      this.pathToHash.set(metadata.path, hash);
      return hash;
    }
    
    const node: MerkleNode = {
      hash,
      data,
      links: [...links].sort(),
      metadata: { ...metadata }
    };
    
    this.nodes.set(hash, node);
    this.pathToHash.set(metadata.path, hash);
    
    return hash;
  }
  
  get(hash: string): MerkleNode | undefined {
    return this.nodes.get(hash);
  }
  
  getByPath(path: string): MerkleNode | undefined {
    const hash = this.pathToHash.get(path);
    return hash ? this.nodes.get(hash) : undefined;
  }
  
  has(hash: string): boolean {
    return this.nodes.has(hash);
  }
  
  update(oldHash: string, data: Uint8Array, links: string[]): string {
    const oldNode = this.nodes.get(oldHash);
    if (!oldNode) throw new Error(`Node ${oldHash} not found`);
    
    this.nodes.delete(oldHash);
    this.pathToHash.delete(oldNode.metadata.path);
    
    return this.add(data, oldNode.metadata, links);
  }
  
  getLinks(hash: string): string[] {
    return this.nodes.get(hash)?.links ?? [];
  }
  
  size(): number {
    return this.nodes.size;
  }
  
  clear(): void {
    this.nodes.clear();
    this.pathToHash.clear();
  }
  
  getAllHashes(): string[] {
    return Array.from(this.nodes.keys());
  }
  
  *traverse(rootHash: string): Generator<MerkleNode> {
    const visited = new Set<string>();
    const queue = [rootHash];
    
    while (queue.length > 0) {
      const hash = queue.shift()!;
      if (visited.has(hash)) continue;
      
      visited.add(hash);
      const node = this.nodes.get(hash);
      
      if (node) {
        yield node;
        queue.push(...node.links);
      }
    }
  }
}
