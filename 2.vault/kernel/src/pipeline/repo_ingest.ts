// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/pipeline/repo_ingest.ts
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export interface DAGNode {
  hash: string;
  path: string;
  type: 'file' | 'directory' | 'root';
  size: number;
  children: DAGNode[];
  content?: Uint8Array;
  mtime: number;
  language?: string;
  astNodeCount: number;
}

export interface IngestionStats {
  totalFiles: number;
  totalBytes: number;
  astNodesCount: number;
  ingestionTimeMs: number;
  dagDepth: number;
  totalNodes: number;
}

export interface DAGDiffResult {
  added: DAGNode[];
  modified: DAGNode[];
  deleted: DAGNode[];
  unchanged: number;
  newRoot: DAGNode;
  stats: IngestionStats;
}

interface ScanEntry {
  absolutePath: string;
  relativePath: string;
  stats: { size: number; mtimeMs: number; isDirectory: boolean; isFile: boolean };
}

export class RepoIngestionPipeline {
  private static readonly IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'out',
    'coverage',
    '.cache',
    'target',
    '__pycache__',
    '.venv',
    'venv',
    '.idea',
    '.vscode',
    'tmp',
    'temp',
  ]);

  private static readonly BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.mp4', '.webm', '.mp3', '.wav', '.ogg',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.pyc', '.class', '.o', '.obj',
  ]);

  private static readonly LANGUAGE_MAP: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.sql': 'sql',
  };

  private hashCache: Map<string, string> = new Map();
  private nodeCache: Map<string, DAGNode> = new Map();

  async ingestRepository(dirPath: string): Promise<{ dagRoot: DAGNode; stats: IngestionStats }> {
    const startTime = performance.now();
    
    this.hashCache.clear();
    this.nodeCache.clear();
    
    let totalFiles = 0;
    let totalBytes = 0;
    let astNodesCount = 0;
    let dagDepth = 0;
    let totalNodes = 0;

    const rootNode = await this.buildDAGTree(dirPath, dirPath, 0);
    
    const collectStats = (node: DAGNode, depth: number) => {
      totalNodes++;
      dagDepth = Math.max(dagDepth, depth);
      
      if (node.type === 'file') {
        totalFiles++;
        totalBytes += node.size;
        astNodesCount += node.astNodeCount;
      }
      
      for (const child of node.children) {
        collectStats(child, depth + 1);
      }
    };
    
    collectStats(rootNode, 0);
    
    const endTime = performance.now();
    
    const stats: IngestionStats = {
      totalFiles,
      totalBytes,
      astNodesCount,
      ingestionTimeMs: endTime - startTime,
      dagDepth,
      totalNodes,
    };

    return { dagRoot: rootNode, stats };
  }

  async getIncrementalDiff(oldRoot: DAGNode, dirPath: string): Promise<DAGDiffResult> {
    const startTime = performance.now();
    
    const oldMap = this.flattenDAG(oldRoot);
    
    const { dagRoot: newRoot } = await this.ingestRepository(dirPath);
    const newMap = this.flattenDAG(newRoot);
    
    const added: DAGNode[] = [];
    const modified: DAGNode[] = [];
    const deleted: DAGNode[] = [];
    let unchanged = 0;
    
    for (const [path, newNode] of newMap.entries()) {
      const oldNode = oldMap.get(path);
      
      if (!oldNode) {
        added.push(newNode);
      } else if (oldNode.hash !== newNode.hash) {
        modified.push(newNode);
      } else {
        unchanged++;
      }
    }
    
    for (const [path, oldNode] of oldMap.entries()) {
      if (!newMap.has(path)) {
        deleted.push(oldNode);
      }
    }
    
    const endTime = performance.now();
    
    let totalFiles = 0;
    let totalBytes = 0;
    let astNodesCount = 0;
    
    const countStats = (node: DAGNode) => {
      if (node.type === 'file') {
        totalFiles++;
        totalBytes += node.size;
        astNodesCount += node.astNodeCount;
      }
      for (const child of node.children) {
        countStats(child);
      }
    };
    
    countStats(newRoot);
    
    const stats: IngestionStats = {
      totalFiles,
      totalBytes,
      astNodesCount,
      ingestionTimeMs: endTime - startTime,
      dagDepth: this.calculateDepth(newRoot),
      totalNodes: newMap.size,
    };

    return {
      added,
      modified,
      deleted,
      unchanged,
      newRoot,
      stats,
    };
  }

  private async buildDAGTree(
    rootPath: string,
    currentPath: string,
    depth: number
  ): Promise<DAGNode> {
    const stats = await stat(currentPath);
    const relativePath = relative(rootPath, currentPath) || '.';
    
    if (stats.isFile()) {
      return this.createFileNode(currentPath, relativePath, stats);
    }
    
    if (stats.isDirectory()) {
      return this.createDirectoryNode(rootPath, currentPath, relativePath, stats, depth);
    }
    
    throw new Error(`Unsupported file type: ${currentPath}`);
  }

  private async createFileNode(
    absolutePath: string,
    relativePath: string,
    stats: { size: number; mtimeMs: number }
  ): Promise<DAGNode> {
    const cacheKey = `${absolutePath}:${stats.mtimeMs}`;
    
    if (this.nodeCache.has(cacheKey)) {
      return this.nodeCache.get(cacheKey)!;
    }
    
    const ext = this.getExtension(absolutePath);
    
    if (this.isBinaryFile(ext)) {
      const hash = this.hashString(`binary:${absolutePath}:${stats.size}:${stats.mtimeMs}`);
      
      const node: DAGNode = {
        hash,
        path: relativePath,
        type: 'file',
        size: stats.size,
        children: [],
        mtime: stats.mtimeMs,
        astNodeCount: 0,
      };
      
      this.nodeCache.set(cacheKey, node);
      return node;
    }
    
    const content = await readFile(absolutePath);
    const contentStr = content.toString('utf-8');
    const language = this.detectLanguage(ext);
    const astNodeCount = language ? this.countASTNodes(contentStr, language) : 0;
    
    const hash = this.hashContent(content, relativePath, stats.mtimeMs);
    
    const node: DAGNode = {
      hash,
      path: relativePath,
      type: 'file',
      size: stats.size,
      children: [],
      content,
      mtime: stats.mtimeMs,
      language,
      astNodeCount,
    };
    
    this.nodeCache.set(cacheKey, node);
    return node;
  }

  private async createDirectoryNode(
    rootPath: string,
    currentPath: string,
    relativePath: string,
    stats: { size: number; mtimeMs: number },
    depth: number
  ): Promise<DAGNode> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const children: DAGNode[] = [];
    
    for (const entry of entries) {
      if (RepoIngestionPipeline.IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      
      if (entry.name.startsWith('.') && entry.isDirectory()) {
        continue;
      }
      
      const childPath = join(currentPath, entry.name);
      
      try {
        const childNode = await this.buildDAGTree(rootPath, childPath, depth + 1);
        children.push(childNode);
      } catch (error) {
        continue;
      }
    }
    
    children.sort((a, b) => a.path.localeCompare(b.path));
    
    const childHashes = children.map(c => c.hash);
    const hash = this.hashString(`dir:${relativePath}:${childHashes.join(',')}`);
    
    let totalSize = 0;
    let totalASTNodes = 0;
    
    for (const child of children) {
      totalSize += child.size;
      totalASTNodes += child.astNodeCount;
    }
    
    const type = relativePath === '.' ? 'root' : 'directory';
    
    const node: DAGNode = {
      hash,
      path: relativePath,
      type,
      size: totalSize,
      children,
      mtime: stats.mtimeMs,
      astNodeCount: totalASTNodes,
    };
    
    return node;
  }

  private flattenDAG(root: DAGNode): Map<string, DAGNode> {
    const map = new Map<string, DAGNode>();
    
    const traverse = (node: DAGNode) => {
      map.set(node.path, node);
      for (const child of node.children) {
        traverse(child);
      }
    };
    
    traverse(root);
    return map;
  }

  private calculateDepth(node: DAGNode, current: number = 0): number {
    if (node.children.length === 0) {
      return current;
    }
    
    let maxDepth = current;
    for (const child of node.children) {
      maxDepth = Math.max(maxDepth, this.calculateDepth(child, current + 1));
    }
    
    return maxDepth;
  }

  private hashContent(content: Uint8Array, path: string, mtime: number): string {
    const key = `${path}:${mtime}`;
    
    if (this.hashCache.has(key)) {
      return this.hashCache.get(key)!;
    }
    
    const hash = createHash('sha256')
      .update(content)
      .update(path)
      .digest('hex');
    
    this.hashCache.set(key, hash);
    return hash;
  }

  private hashString(input: string): string {
    if (this.hashCache.has(input)) {
      return this.hashCache.get(input)!;
    }
    
    const hash = createHash('sha256').update(input).digest('hex');
    this.hashCache.set(input, hash);
    return hash;
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    const lastSlash = filename.lastIndexOf(sep);
    
    if (lastDot > lastSlash && lastDot !== -1) {
      return filename.substring(lastDot).toLowerCase();
    }
    
    return '';
  }

  private isBinaryFile(ext: string): boolean {
    return RepoIngestionPipeline.BINARY_EXTENSIONS.has(ext);
  }

  private detectLanguage(ext: string): string | undefined {
    return RepoIngestionPipeline.LANGUAGE_MAP[ext];
  }

  private countASTNodes(content: string, language: string): number {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.countJSASTNodes(content);
      case 'python':
        return this.countPythonASTNodes(content);
      case 'go':
        return this.countGoASTNodes(content);
      case 'rust':
        return this.countRustASTNodes(content);
      default:
        return this.estimateASTNodes(content);
    }
  }

  private countJSASTNodes(content: string): number {
    let count = 0;
    
    const patterns = [
      /\bfunction\b/g,
      /\bclass\b/g,
      /\bconst\b/g,
      /\blet\b/g,
      /\bvar\b/g,
      /\bif\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bswitch\b/g,
      /\breturn\b/g,
      /\bimport\b/g,
      /\bexport\b/g,
      /\basync\b/g,
      /\bawait\b/g,
      /=>/g,
      /\{/g,
    ];
    
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      count += matches ? matches.length : 0;
    }
    
    return count;
  }

  private countPythonASTNodes(content: string): number {
    let count = 0;
    
    const patterns = [
      /\bdef\b/g,
      /\bclass\b/g,
      /\bif\b/g,
      /\belif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\breturn\b/g,
      /\bimport\b/g,
      /\bfrom\b/g,
      /\basync\b/g,
      /\bawait\b/g,
      /\blambda\b/g,
      /:/g,
    ];
    
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      count += matches ? matches.length : 0;
    }
    
    return count;
  }

  private countGoASTNodes(content: string): number {
    let count = 0;
    
    const patterns = [
      /\bfunc\b/g,
      /\btype\b/g,
      /\bstruct\b/g,
      /\binterface\b/g,
      /\bif\b/g,
      /\bfor\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\breturn\b/g,
      /\bimport\b/g,
      /\bvar\b/g,
      /\bconst\b/g,
      /\{/g,
    ];
    
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      count += matches ? matches.length : 0;
    }
    
    return count;
  }

  private countRustASTNodes(content: string): number {
    let count = 0;
    
    const patterns = [
      /\bfn\b/g,
      /\bstruct\b/g,
      /\benum\b/g,
      /\bimpl\b/g,
      /\btrait\b/g,
      /\bif\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bmatch\b/g,
      /\blet\b/g,
      /\buse\b/g,
      /\bmod\b/g,
      /\{/g,
    ];
    
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      count += matches ? matches.length : 0;
    }
    
    return count;
  }

  private estimateASTNodes(content: string): number {
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    return Math.floor(lines.length * 1.5);
  }

  getNodeByPath(root: DAGNode, targetPath: string): DAGNode | null {
    if (root.path === targetPath) {
      return root;
    }
    
    for (const child of root.children) {
      const found = this.getNodeByPath(child, targetPath);
      if (found) return found;
    }
    
    return null;
  }

  serializeDAG(node: DAGNode): string {
    const simplified = this.simplifyNode(node);
    return JSON.stringify(simplified, null, 2);
  }

  private simplifyNode(node: DAGNode): any {
    return {
      hash: node.hash,
      path: node.path,
      type: node.type,
      size: node.size,
      mtime: node.mtime,
      language: node.language,
      astNodeCount: node.astNodeCount,
      childCount: node.children.length,
      children: node.children.map(c => this.simplifyNode(c)),
    };
  }

  clearCache(): void {
    this.hashCache.clear();
    this.nodeCache.clear();
  }

  getCacheStats(): { hashCacheSize: number; nodeCacheSize: number } {
    return {
      hashCacheSize: this.hashCache.size,
      nodeCacheSize: this.nodeCache.size,
    };
  }
}
