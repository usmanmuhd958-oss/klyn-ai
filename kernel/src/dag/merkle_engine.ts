import { createHash } from 'node:crypto';

/**
 * Represents a node in the Merkle DAG
 */
export interface DAGNode {
  id: string;
  hash: string;
  path: string;
  content: string | null;
  children: Map<string, DAGNode>;
  size: number;
  timestamp: number;
  metadata: Record<string, unknown>;
}

/**
 * Result of comparing two DAG trees
 */
export interface DAGDiffResult {
  added: DAGNode[];
  modified: Array<{ oldNode: DAGNode; newNode: DAGNode; patchContext?: string }>;
  deleted: DAGNode[];
  unchangedHashes: string[];
}

/**
 * Serializable representation of DAGNode
 */
interface SerializableDAGNode {
  id: string;
  hash: string;
  path: string;
  content: string | null;
  children: Record<string, SerializableDAGNode>;
  size: number;
  timestamp: number;
  metadata: Record<string, unknown>;
}

/**
 * Production-grade Merkle DAG Engine for content-addressable storage
 * Optimized for ultra-lightweight environments with minimal memory footprint
 */
export class MerkleDAGEngine {
  private readonly maxTraversalDepth = 10000;

  /**
   * Creates a leaf node with content-based SHA-256 hash
   */
  public createLeafNode(
    path: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): DAGNode {
    if (!path) {
      throw new Error('Path cannot be empty');
    }

    const size = Buffer.byteLength(content, 'utf8');
    const timestamp = Date.now();
    const hash = this.computeLeafHash(content, metadata);

    return {
      id: path,
      hash,
      path,
      content,
      children: new Map(),
      size,
      timestamp,
      metadata: { ...metadata }
    };
  }

  /**
   * Creates a directory node with Merkle hash from children
   */
  public createDirectoryNode(path: string, children: DAGNode[]): DAGNode {
    if (!path) {
      throw new Error('Path cannot be empty');
    }

    const childrenMap = new Map<string, DAGNode>();
    let totalSize = 0;
    let latestTimestamp = 0;

    for (const child of children) {
      if (childrenMap.has(child.id)) {
        throw new Error(`Duplicate child ID detected: ${child.id}`);
      }
      childrenMap.set(child.id, child);
      totalSize += child.size;
      latestTimestamp = Math.max(latestTimestamp, child.timestamp);
    }

    const hash = this.computeDirectoryHash(childrenMap);

    return {
      id: path,
      hash,
      path,
      content: null,
      children: childrenMap,
      size: totalSize,
      timestamp: latestTimestamp || Date.now(),
      metadata: {}
    };
  }

  /**
   * Computes the SHA-256 hash for a leaf node
   */
  private computeLeafHash(content: string, metadata: Record<string, unknown>): string {
    const hasher = createHash('sha256');
    hasher.update(content);
    
    const metadataKeys = Object.keys(metadata).sort();
    for (const key of metadataKeys) {
      hasher.update(key);
      hasher.update(JSON.stringify(metadata[key]));
    }
    
    return hasher.digest('hex');
  }

  /**
   * Computes the SHA-256 Merkle hash for a directory node
   */
  private computeDirectoryHash(children: Map<string, DAGNode>): string {
    const hasher = createHash('sha256');
    
    const sortedEntries = Array.from(children.entries()).sort((a, b) => 
      a[0].localeCompare(b[0])
    );
    
    for (const [id, child] of sortedEntries) {
      hasher.update(id);
      hasher.update(child.hash);
    }
    
    return hasher.digest('hex');
  }

  /**
   * High-speed recursive DAG diffing with O(1) fast path for identical subtrees
   */
  public computeDiff(oldRoot: DAGNode, newRoot: DAGNode): DAGDiffResult {
    const result: DAGDiffResult = {
      added: [],
      modified: [],
      deleted: [],
      unchangedHashes: []
    };

    if (oldRoot.hash === newRoot.hash) {
      this.collectAllHashes(oldRoot, result.unchangedHashes);
      return result;
    }

    this.diffRecursive(oldRoot, newRoot, result, new Set(), 0);
    
    return result;
  }

  /**
   * Recursive diff implementation with cycle detection
   */
  private diffRecursive(
    oldNode: DAGNode,
    newNode: DAGNode,
    result: DAGDiffResult,
    visited: Set<string>,
    depth: number
  ): void {
    if (depth > this.maxTraversalDepth) {
      throw new Error('Maximum traversal depth exceeded - possible cycle detected');
    }

    const visitKey = `${oldNode.hash}:${newNode.hash}`;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

    if (oldNode.hash === newNode.hash) {
      result.unchangedHashes.push(oldNode.hash);
      return;
    }

    if (oldNode.content !== null && newNode.content !== null) {
      const patchContext = this.generatePatchContext(oldNode.content, newNode.content);
      result.modified.push({ oldNode, newNode, patchContext });
      return;
    }

    if ((oldNode.content === null) !== (newNode.content === null)) {
      result.modified.push({ oldNode, newNode });
      return;
    }

    const oldChildren = oldNode.children;
    const newChildren = newNode.children;
    const oldKeys = new Set(oldChildren.keys());
    const newKeys = new Set(newChildren.keys());

    for (const key of newKeys) {
      if (!oldKeys.has(key)) {
        const addedNode = newChildren.get(key);
        if (addedNode) {
          result.added.push(addedNode);
        }
      }
    }

    for (const key of oldKeys) {
      if (!newKeys.has(key)) {
        const deletedNode = oldChildren.get(key);
        if (deletedNode) {
          result.deleted.push(deletedNode);
        }
      }
    }

    for (const key of oldKeys) {
      if (newKeys.has(key)) {
        const oldChild = oldChildren.get(key);
        const newChild = newChildren.get(key);
        
        if (oldChild && newChild) {
          this.diffRecursive(oldChild, newChild, result, visited, depth + 1);
        }
      }
    }
  }

  /**
   * Generates compact patch context for content changes
   */
  private generatePatchContext(oldContent: string, newContent: string): string {
    if (oldContent === newContent) {
      return 'identical';
    }
    
    const oldLength = oldContent.length;
    const newLength = newContent.length;
    const sizeDelta = newLength - oldLength;
    
    return `size_delta:${sizeDelta > 0 ? '+' : ''}${sizeDelta}|old:${oldLength}|new:${newLength}`;
  }

  /**
   * Collects all hashes from a subtree using iterative traversal
   */
  private collectAllHashes(node: DAGNode, hashes: string[]): void {
    const visited = new Set<string>();
    const stack: Array<{ node: DAGNode; depth: number }> = [{ node, depth: 0 }];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      const { node: currentNode, depth } = current;

      if (depth > this.maxTraversalDepth) {
        throw new Error('Maximum traversal depth exceeded - possible cycle detected');
      }

      if (visited.has(currentNode.hash)) {
        continue;
      }
      
      visited.add(currentNode.hash);
      hashes.push(currentNode.hash);

      for (const child of currentNode.children.values()) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }

  /**
   * Fast hash-based node lookup with breadth-first graph traversal
   */
  public getNodeByHash(root: DAGNode, targetHash: string): DAGNode | null {
    if (root.hash === targetHash) {
      return root;
    }

    const visited = new Set<string>();
    const queue: Array<{ node: DAGNode; depth: number }> = [{ node: root, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      const { node: currentNode, depth } = current;

      if (depth > this.maxTraversalDepth) {
        throw new Error('Maximum traversal depth exceeded - possible cycle detected');
      }

      if (currentNode.hash === targetHash) {
        return currentNode;
      }

      if (visited.has(currentNode.hash)) {
        continue;
      }
      visited.add(currentNode.hash);

      for (const child of currentNode.children.values()) {
        queue.push({ node: child, depth: depth + 1 });
      }
    }

    return null;
  }

  /**
   * Serializes DAG to JSON string with deduplication for shared subtrees
   */
  public serialize(root: DAGNode): string {
    const serializable = this.nodeToSerializable(root, new Set());
    return JSON.stringify(serializable);
  }

  /**
   * Converts DAGNode to serializable format with reference handling
   */
  private nodeToSerializable(node: DAGNode, visited: Set<string>): SerializableDAGNode {
    if (visited.has(node.hash)) {
      return {
        id: node.id,
        hash: node.hash,
        path: node.path,
        content: null,
        children: {},
        size: node.size,
        timestamp: node.timestamp,
        metadata: { _ref: true }
      };
    }

    visited.add(node.hash);

    const children: Record<string, SerializableDAGNode> = {};
    
    for (const [key, child] of node.children.entries()) {
      children[key] = this.nodeToSerializable(child, visited);
    }

    return {
      id: node.id,
      hash: node.hash,
      path: node.path,
      content: node.content,
      children,
      size: node.size,
      timestamp: node.timestamp,
      metadata: node.metadata
    };
  }

  /**
   * Deserializes JSON string to DAGNode with caching for shared nodes
   */
  public deserialize(jsonString: string): DAGNode {
    if (!jsonString || jsonString.trim() === '') {
      throw new Error('Cannot deserialize empty string');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
    }

    if (!this.isSerializableDAGNode(parsed)) {
      throw new Error('Invalid DAGNode structure');
    }

    const cache = new Map<string, DAGNode>();
    return this.serializableToNode(parsed, cache);
  }

  /**
   * Type guard for SerializableDAGNode
   */
  private isSerializableDAGNode(value: unknown): value is SerializableDAGNode {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const obj = value as Record<string, unknown>;

    return (
      typeof obj.id === 'string' &&
      typeof obj.hash === 'string' &&
      typeof obj.path === 'string' &&
      (typeof obj.content === 'string' || obj.content === null) &&
      typeof obj.children === 'object' &&
      obj.children !== null &&
      typeof obj.size === 'number' &&
      typeof obj.timestamp === 'number' &&
      typeof obj.metadata === 'object' &&
      obj.metadata !== null
    );
  }

  /**
   * Converts serializable format back to DAGNode
   */
  private serializableToNode(
    serializable: SerializableDAGNode,
    cache: Map<string, DAGNode>
  ): DAGNode {
    if (serializable.metadata._ref === true) {
      const referenced = cache.get(serializable.hash);
      if (!referenced) {
        throw new Error(`Reference node ${serializable.id} (${serializable.hash}) not found in cache - corrupted data`);
      }
      return referenced;
    }

    if (cache.has(serializable.hash)) {
      const cached = cache.get(serializable.hash);
      if (cached) {
        return cached;
      }
    }

    const children = new Map<string, DAGNode>();

    const node: DAGNode = {
      id: serializable.id,
      hash: serializable.hash,
      path: serializable.path,
      content: serializable.content,
      children,
      size: serializable.size,
      timestamp: serializable.timestamp,
      metadata: { ...serializable.metadata }
    };

    cache.set(serializable.hash, node);

    for (const [key, child] of Object.entries(serializable.children)) {
      children.set(key, this.serializableToNode(child, cache));
    }

    return node;
  }

  /**
   * Validates DAG integrity - no cycles, valid hashes, structural correctness
   */
  public validateDAG(root: DAGNode): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    this.validateNode(root, visited, recursionStack, errors, 0);

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Recursive node validation with cycle detection
   */
  private validateNode(
    node: DAGNode,
    visited: Set<string>,
    recursionStack: Set<string>,
    errors: string[],
    depth: number
  ): void {
    if (depth > this.maxTraversalDepth) {
      errors.push(`Maximum depth exceeded at node ${node.id}`);
      return;
    }

    if (recursionStack.has(node.hash)) {
      errors.push(`Cycle detected at node ${node.id} (hash: ${node.hash})`);
      return;
    }

    if (visited.has(node.hash)) {
      return;
    }

    recursionStack.add(node.hash);
    visited.add(node.hash);

    if (node.content !== null) {
      const expectedHash = this.computeLeafHash(node.content, node.metadata);
      if (expectedHash !== node.hash) {
        errors.push(`Hash mismatch at leaf node ${node.id}: expected ${expectedHash}, got ${node.hash}`);
      }
    } else {
      const expectedHash = this.computeDirectoryHash(node.children);
      if (expectedHash !== node.hash) {
        errors.push(`Hash mismatch at directory node ${node.id}: expected ${expectedHash}, got ${node.hash}`);
      }
    }

    for (const child of node.children.values()) {
      this.validateNode(child, visited, recursionStack, errors, depth + 1);
    }

    recursionStack.delete(node.hash);
  }
}
