// kernel/src/indexer/merkle_dag.ts

import { createHash } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { EventEmitter } from 'node:events';

/**
 * Sub-millisecond Merkle DAG Differential Sync Engine
 * Zero unnecessary disk reads through path-only mutation
 * @version 1.0.0
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface MerkleNode {
  path: string;
  hash: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
  children: Map<string, MerkleNode>;
  parent: MerkleNode | null;
}

export interface DiffEntry {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  oldHash?: string;
  newHash?: string;
  timestamp: number;
}

export interface MerkleSnapshot {
  rootHash: string;
  timestamp: number;
  nodeCount: number;
  totalSize: number;
}

export interface IndexStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  indexTime: number;
  lastSync: number;
}

export interface MerkleDAGConfig {
  rootPath: string;
  ignorePaths: string[];
  ignorePatterns: RegExp[];
  maxFileSize: number;
  hashAlgorithm: 'sha256' | 'sha1' | 'md5';
  enableWatcher: boolean;
}

// ============================================================================
// Fast Hash Utilities
// ============================================================================

class HashCache {
  private cache: Map<string, { hash: string; mtime: number; size: number }> = new Map();
  private maxSize: number = 10000;

  public get(path: string, mtime: number, size: number): string | null {
    const cached = this.cache.get(path);
    if (cached && cached.mtime === mtime && cached.size === size) {
      return cached.hash;
    }
    return null;
  }

  public set(path: string, hash: string, mtime: number, size: number): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(path, { hash, mtime, size });
  }

  public invalidate(path: string): void {
    this.cache.delete(path);
  }

  public clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Merkle DAG Implementation
// ============================================================================

export class MerkleDAG extends EventEmitter {
  private config: MerkleDAGConfig;
  private root: MerkleNode | null = null;
  private pathIndex: Map<string, MerkleNode> = new Map();
  private hashCache: HashCache = new HashCache();
  private stats: IndexStats;

  constructor(config: Partial<MerkleDAGConfig> = {}) {
    super();
    
    this.config = {
      rootPath: config.rootPath ?? process.cwd(),
      ignorePaths: config.ignorePaths ?? [
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
        'coverage',
        '.cache',
      ],
      ignorePatterns: config.ignorePatterns ?? [
        /\.log$/,
        /\.lock$/,
        /\.tmp$/,
        /\.swp$/,
        /^\./,
      ],
      maxFileSize: config.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      hashAlgorithm: config.hashAlgorithm ?? 'sha256',
      enableWatcher: config.enableWatcher ?? false,
    };

    this.stats = {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      indexTime: 0,
      lastSync: 0,
    };
  }

  // ============================================================================
  // Indexing
  // ============================================================================

  public async buildIndex(): Promise<MerkleSnapshot> {
    const startTime = performance.now();

    this.emit('index:start', this.config.rootPath);

    try {
      this.root = await this.indexDirectory(this.config.rootPath, null);
      
      this.stats.indexTime = performance.now() - startTime;
      this.stats.lastSync = Date.now();

      const snapshot: MerkleSnapshot = {
        rootHash: this.root.hash,
        timestamp: this.stats.lastSync,
        nodeCount: this.pathIndex.size,
        totalSize: this.stats.totalSize,
      };

      this.emit('index:complete', snapshot);

      return snapshot;
    } catch (error) {
      this.emit('index:error', error);
      throw error;
    }
  }

  private async indexDirectory(
    dirPath: string,
    parent: MerkleNode | null
  ): Promise<MerkleNode> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const children = new Map<string, MerkleNode>();
    const hashes: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(this.config.rootPath, fullPath);

      // Skip ignored paths
      if (this.shouldIgnore(relativePath, entry.name)) {
        continue;
      }

      try {
        if (entry.isDirectory()) {
          const childNode = await this.indexDirectory(fullPath, null);
          children.set(entry.name, childNode);
          hashes.push(`${entry.name}:${childNode.hash}`);
          this.stats.totalDirectories++;
        } else if (entry.isFile()) {
          const childNode = await this.indexFile(fullPath, null);
          children.set(entry.name, childNode);
          hashes.push(`${entry.name}:${childNode.hash}`);
          this.stats.totalFiles++;
        }
      } catch (error) {
        // Skip files that can't be read
        this.emit('index:skip', fullPath, error);
      }
    }

    // Sort hashes for deterministic ordering
    hashes.sort();

    const dirStats = await stat(dirPath);
    const combinedHash = this.hashStrings(hashes);

    const node: MerkleNode = {
      path: dirPath,
      hash: combinedHash,
      type: 'directory',
      size: 0,
      modified: dirStats.mtimeMs,
      children,
      parent,
    };

    // Update parent references
    for (const child of children.values()) {
      child.parent = node;
    }

    this.pathIndex.set(dirPath, node);

    return node;
  }

  private async indexFile(
    filePath: string,
    parent: MerkleNode | null
  ): Promise<MerkleNode> {
    const fileStats = await stat(filePath);

    // Skip large files
    if (fileStats.size > this.config.maxFileSize) {
      throw new Error(`File too large: ${filePath}`);
    }

    // Check cache first
    const cachedHash = this.hashCache.get(
      filePath,
      fileStats.mtimeMs,
      fileStats.size
    );

    let hash: string;

    if (cachedHash) {
      hash = cachedHash;
    } else {
      const content = await readFile(filePath);
      hash = this.hashBuffer(content);
      this.hashCache.set(filePath, hash, fileStats.mtimeMs, fileStats.size);
    }

    this.stats.totalSize += fileStats.size;

    const node: MerkleNode = {
      path: filePath,
      hash,
      type: 'file',
      size: fileStats.size,
      modified: fileStats.mtimeMs,
      children: new Map(),
      parent,
    };

    this.pathIndex.set(filePath, node);

    return node;
  }

  private shouldIgnore(relativePath: string, name: string): boolean {
    // Check ignore paths
    for (const ignorePath of this.config.ignorePaths) {
      if (
        relativePath === ignorePath ||
        relativePath.startsWith(ignorePath + sep)
      ) {
        return true;
      }
    }

    // Check ignore patterns
    for (const pattern of this.config.ignorePatterns) {
      if (pattern.test(name) || pattern.test(relativePath)) {
        return true;
      }
    }

    return false;
  }

  // ============================================================================
  // Differential Updates (Path-Only Mutation)
  // ============================================================================

  public async updatePath(filePath: string): Promise<DiffEntry[]> {
    const startTime = performance.now();
    const diffs: DiffEntry[] = [];

    try {
      const oldNode = this.pathIndex.get(filePath);
      const exists = await this.fileExists(filePath);

      if (!exists && oldNode) {
        // File deleted
        await this.handleDeletion(filePath, diffs);
      } else if (exists && !oldNode) {
        // File added
        await this.handleAddition(filePath, diffs);
      } else if (exists && oldNode) {
        // File potentially modified
        await this.handleModification(filePath, oldNode, diffs);
      }

      // Propagate hash changes up to root
      if (diffs.length > 0) {
        await this.propagateHashChanges(filePath);
      }

      this.emit('update:complete', filePath, diffs, performance.now() - startTime);

      return diffs;
    } catch (error) {
      this.emit('update:error', filePath, error);
      throw error;
    }
  }

  private async handleDeletion(
    filePath: string,
    diffs: DiffEntry[]
  ): Promise<void> {
    const node = this.pathIndex.get(filePath)!;

    diffs.push({
      path: filePath,
      type: 'deleted',
      oldHash: node.hash,
      timestamp: Date.now(),
    });

    // Remove from parent's children
    if (node.parent) {
      const fileName = filePath.split(sep).pop()!;
      node.parent.children.delete(fileName);
    }

    // Remove from index (including all children for directories)
    this.removeFromIndex(node);
  }

  private async handleAddition(
    filePath: string,
    diffs: DiffEntry[]
  ): Promise<void> {
    const fileStats = await stat(filePath);
    const parentPath = join(filePath, '..');
    const parent = this.pathIndex.get(parentPath);

    let newNode: MerkleNode;

    if (fileStats.isDirectory()) {
      newNode = await this.indexDirectory(filePath, parent ?? null);
    } else {
      newNode = await this.indexFile(filePath, parent ?? null);
    }

    diffs.push({
      path: filePath,
      type: 'added',
      newHash: newNode.hash,
      timestamp: Date.now(),
    });

    // Add to parent's children
    if (parent) {
      const fileName = filePath.split(sep).pop()!;
      parent.children.set(fileName, newNode);
      newNode.parent = parent;
    }
  }

  private async handleModification(
    filePath: string,
    oldNode: MerkleNode,
    diffs: DiffEntry[]
  ): Promise<void> {
    const fileStats = await stat(filePath);

    // Quick check: if mtime and size haven't changed, skip
    if (
      fileStats.mtimeMs === oldNode.modified &&
      fileStats.size === oldNode.size
    ) {
      return;
    }

    if (oldNode.type === 'directory') {
      // Re-index directory
      const newNode = await this.indexDirectory(filePath, oldNode.parent);

      if (newNode.hash !== oldNode.hash) {
        diffs.push({
          path: filePath,
          type: 'modified',
          oldHash: oldNode.hash,
          newHash: newNode.hash,
          timestamp: Date.now(),
        });

        // Update node in place
        Object.assign(oldNode, newNode);
      }
    } else {
      // Re-hash file
      const content = await readFile(filePath);
      const newHash = this.hashBuffer(content);

      if (newHash !== oldNode.hash) {
        diffs.push({
          path: filePath,
          type: 'modified',
          oldHash: oldNode.hash,
          newHash: newHash,
          timestamp: Date.now(),
        });

        oldNode.hash = newHash;
        oldNode.size = fileStats.size;
        oldNode.modified = fileStats.mtimeMs;

        this.hashCache.set(filePath, newHash, fileStats.mtimeMs, fileStats.size);
      }
    }
  }

  private async propagateHashChanges(filePath: string): Promise<void> {
    let node = this.pathIndex.get(filePath);

    while (node?.parent) {
      const parent = node.parent;
      const hashes: string[] = [];

      // Recalculate parent hash from children
      for (const [name, child] of parent.children.entries()) {
        hashes.push(`${name}:${child.hash}`);
      }

      hashes.sort();
      const newHash = this.hashStrings(hashes);

      if (newHash === parent.hash) {
        // No change in parent, stop propagation
        break;
      }

      parent.hash = newHash;
      node = parent;
    }

    // Update root hash
    if (this.root && node === this.root) {
      this.emit('root:updated', this.root.hash);
    }
  }

  private removeFromIndex(node: MerkleNode): void {
    this.pathIndex.delete(node.path);

    for (const child of node.children.values()) {
      this.removeFromIndex(child);
    }
  }

  // ============================================================================
  // Hash Functions
  // ============================================================================

  private hashBuffer(buffer: Buffer): string {
    return createHash(this.config.hashAlgorithm)
      .update(buffer)
      .digest('hex')
      .substring(0, 16); // First 16 chars for speed
  }

  private hashStrings(strings: string[]): string {
    const combined = strings.join('\n');
    return createHash(this.config.hashAlgorithm)
      .update(combined)
      .digest('hex')
      .substring(0, 16);
  }

  // ============================================================================
  // Query Interface
  // ============================================================================

  public getNode(path: string): MerkleNode | undefined {
    return this.pathIndex.get(path);
  }

  public getFilesByPattern(pattern: RegExp): MerkleNode[] {
    const results: MerkleNode[] = [];

    for (const node of this.pathIndex.values()) {
      if (node.type === 'file' && pattern.test(node.path)) {
        results.push(node);
      }
    }

    return results;
  }

  public getRootHash(): string | null {
    return this.root?.hash ?? null;
  }

  public getStats(): IndexStats {
    return { ...this.stats };
  }

  public getAllFiles(): MerkleNode[] {
    return Array.from(this.pathIndex.values()).filter(n => n.type === 'file');
  }

  public exportSnapshot(): string {
    const snapshot = {
      rootHash: this.root?.hash,
      timestamp: this.stats.lastSync,
      stats: this.stats,
      paths: Array.from(this.pathIndex.entries()).map(([path, node]) => ({
        path,
        hash: node.hash,
        type: node.type,
        size: node.size,
      })),
    };

    return JSON.stringify(snapshot, null, 2);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  public clear(): void {
    this.root = null;
    this.pathIndex.clear();
    this.hashCache.clear();
    this.stats = {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      indexTime: 0,
      lastSync: 0,
    };
  }
}

export default MerkleDAG;
