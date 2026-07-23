// kernel/src/pipeline/repo_ingest.ts

import { DAGNode, MerkleDAGEngine } from '../dag/merkle_engine.js';
import { readFileSync } from 'node:fs';

/**
 * Ingestion metrics for performance tracking
 */
export interface IngestionMetrics {
  fileCount: number;
  totalBytes: number;
  parseTimeMs: number;
  ignoredFileCount: number;
  binaryFileCount: number;
  directoryCount: number;
}

/**
 * File input structure for ingestion
 */
export interface FileInput {
  path: string;
  content: string;
}

/**
 * Ingestion result with root DAG node and metrics
 */
export interface IngestionResult {
  rootNode: DAGNode;
  metrics: IngestionMetrics;
}

/**
 * Directory tree node for hierarchical construction
 */
interface DirectoryTreeNode {
  name: string;
  path: string;
  children: Map<string, DirectoryTreeNode>;
  file: FileInput | null;
}

/**
 * Production-grade Repository Ingestion Pipeline
 * Builds content-addressed Merkle DAG from file arrays in <100ms
 */
export class RepoIngestionPipeline {
  private merkleEngine: MerkleDAGEngine;
  private ignoreRules: RegExp[];
  private binaryExtensions: Set<string>;
  private readonly maxFileSize: number = 10 * 1024 * 1024; // 10MB
  private readonly batchSize: number = 100;

  constructor(merkleEngine?: MerkleDAGEngine) {
    this.merkleEngine = merkleEngine ?? new MerkleDAGEngine();
    this.ignoreRules = this.getDefaultIgnoreRules();
    this.binaryExtensions = this.getDefaultBinaryExtensions();
  }

  /**
   * Ingests file array and builds hierarchical Merkle DAG
   */
  public async ingest(files: FileInput[]): Promise<IngestionResult> {
    const startTime = performance.now();
    
    const metrics: IngestionMetrics = {
      fileCount: 0,
      totalBytes: 0,
      parseTimeMs: 0,
      ignoredFileCount: 0,
      binaryFileCount: 0,
      directoryCount: 0
    };

    // Filter and validate files
    const validFiles = this.filterAndValidateFiles(files, metrics);

    // Build directory tree structure
    const treeRoot = this.buildDirectoryTree(validFiles);

    // Convert tree to DAG nodes recursively
    const rootNode = this.treeNodeToDAGNode(treeRoot, metrics);

    metrics.parseTimeMs = performance.now() - startTime;

    return {
      rootNode,
      metrics
    };
  }

  /**
   * Ingests with custom ignore rules (gitignore-style patterns)
   */
  public async ingestWithIgnoreRules(
    files: FileInput[],
    ignorePatterns: string[]
  ): Promise<IngestionResult> {
    this.ignoreRules = this.parseIgnorePatterns(ignorePatterns);
    return this.ingest(files);
  }

  /**
   * Filters files based on ignore rules and binary detection
   */
  private filterAndValidateFiles(files: FileInput[], metrics: IngestionMetrics): FileInput[] {
    const validFiles: FileInput[] = [];

    for (const file of files) {
      // Check ignore rules
      if (this.shouldIgnoreFile(file.path)) {
        metrics.ignoredFileCount++;
        continue;
      }

      // Check binary detection
      if (this.isBinaryFile(file.path, file.content)) {
        metrics.binaryFileCount++;
        continue;
      }

      // Check file size
      const size = Buffer.byteLength(file.content, 'utf8');
      if (size > this.maxFileSize) {
        metrics.ignoredFileCount++;
        continue;
      }

      metrics.totalBytes += size;
      validFiles.push(file);
    }

    metrics.fileCount = validFiles.length;
    return validFiles;
  }

  /**
   * Builds hierarchical directory tree from flat file list
   */
  private buildDirectoryTree(files: FileInput[]): DirectoryTreeNode {
    const root: DirectoryTreeNode = {
      name: '',
      path: '',
      children: new Map(),
      file: null
    };

    for (const file of files) {
      this.insertIntoTree(root, file);
    }

    return root;
  }

  /**
   * Inserts file into directory tree structure
   */
  private insertIntoTree(root: DirectoryTreeNode, file: FileInput): void {
    const parts = file.path.split('/').filter(p => p.length > 0);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        // Leaf node - file
        const node: DirectoryTreeNode = {
          name: part,
          path: file.path,
          children: new Map(),
          file
        };
        current.children.set(part, node);
      } else {
        // Directory node
        if (!current.children.has(part)) {
          const dirPath = parts.slice(0, i + 1).join('/');
          const node: DirectoryTreeNode = {
            name: part,
            path: dirPath,
            children: new Map(),
            file: null
          };
          current.children.set(part, node);
        }
        current = current.children.get(part)!;
      }
    }
  }

  /**
   * Recursively converts directory tree to DAG nodes
   */
  private treeNodeToDAGNode(treeNode: DirectoryTreeNode, metrics: IngestionMetrics): DAGNode {
    // Leaf node - create file DAG node
    if (treeNode.file !== null) {
      return this.merkleEngine.createLeafNode(
        treeNode.file.path,
        treeNode.file.content,
        {
          type: 'file',
          extension: this.getFileExtension(treeNode.file.path)
        }
      );
    }

    // Directory node - recursively build children
    const childDAGNodes: DAGNode[] = [];

    for (const [name, childTreeNode] of treeNode.children.entries()) {
      const childDAGNode = this.treeNodeToDAGNode(childTreeNode, metrics);
      childDAGNodes.push(childDAGNode);
    }

    metrics.directoryCount++;

    const path = treeNode.path || 'root';
    return this.merkleEngine.createDirectoryNode(path, childDAGNodes);
  }

  /**
   * Parses gitignore-style patterns into regex rules
   */
  private parseIgnorePatterns(patterns: string[]): RegExp[] {
    const rules: RegExp[] = [];

    for (const pattern of patterns) {
      const trimmed = pattern.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Convert gitignore pattern to regex
      let regexPattern = trimmed
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      // Handle directory-specific patterns
      if (regexPattern.endsWith('/')) {
        regexPattern = regexPattern.slice(0, -1) + '(/.*)?';
      }

      // Handle negation (!)
      if (regexPattern.startsWith('!')) {
        continue; // Negation not implemented in this simplified version
      }

      // Anchor pattern
      if (regexPattern.startsWith('/')) {
        regexPattern = '^' + regexPattern.slice(1);
      } else {
        regexPattern = '(^|/)' + regexPattern;
      }

      try {
        rules.push(new RegExp(regexPattern));
      } catch (error) {
        // Skip invalid patterns
        continue;
      }
    }

    return rules;
  }

  /**
   * Checks if file should be ignored based on rules
   */
  private shouldIgnoreFile(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/');

    for (const rule of this.ignoreRules) {
      if (rule.test(normalizedPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detects if file is binary based on extension and content analysis
   */
  private isBinaryFile(path: string, content: string): boolean {
    const ext = this.getFileExtension(path);
    
    if (this.binaryExtensions.has(ext)) {
      return true;
    }

    // Content-based binary detection (heuristic)
    if (content.length === 0) {
      return false;
    }

    // Check for null bytes or high ratio of non-printable characters
    const sample = content.slice(0, Math.min(8192, content.length));
    let nonPrintableCount = 0;

    for (let i = 0; i < sample.length; i++) {
      const charCode = sample.charCodeAt(i);
      
      // Null byte detection
      if (charCode === 0) {
        return true;
      }

      // Count non-printable characters (excluding common whitespace)
      if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
        nonPrintableCount++;
      }
    }

    // If more than 30% non-printable, consider binary
    return (nonPrintableCount / sample.length) > 0.3;
  }

  /**
   * Extracts file extension from path
   */
  private getFileExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    
    if (lastDot > lastSlash && lastDot !== -1) {
      return path.slice(lastDot + 1).toLowerCase();
    }
    
    return '';
  }

  /**
   * Returns default ignore rules for common patterns
   */
  private getDefaultIgnoreRules(): RegExp[] {
    const patterns = [
      'node_modules/',
      '.git/',
      'dist/',
      'build/',
      'coverage/',
      '.next/',
      '.nuxt/',
      'out/',
      '.cache/',
      '.temp/',
      '.tmp/',
      '*.log',
      '.DS_Store',
      'Thumbs.db',
      '*.swp',
      '*.swo',
      '*~'
    ];

    return this.parseIgnorePatterns(patterns);
  }

  /**
   * Returns default binary file extensions
   */
  private getDefaultBinaryExtensions(): Set<string> {
    return new Set([
      // Images
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'svg', 'webp', 'tiff',
      // Videos
      'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv',
      // Audio
      'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
      // Archives
      'zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'xz',
      // Executables
      'exe', 'dll', 'so', 'dylib', 'bin',
      // Documents
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      // Fonts
      'ttf', 'otf', 'woff', 'woff2', 'eot',
      // Other
      'pyc', 'pyo', 'class', 'o', 'a', 'lib'
    ]);
  }

  /**
   * Loads and parses .gitignore file
   */
  public loadGitignore(gitignorePath: string): void {
    try {
      const content = readFileSync(gitignorePath, 'utf8');
      const patterns = content.split('\n');
      this.ignoreRules = [
        ...this.getDefaultIgnoreRules(),
        ...this.parseIgnorePatterns(patterns)
      ];
    } catch (error) {
      // If .gitignore doesn't exist, use defaults
      this.ignoreRules = this.getDefaultIgnoreRules();
    }
  }

  /**
   * Adds custom ignore patterns
   */
  public addIgnorePatterns(patterns: string[]): void {
    this.ignoreRules = [
      ...this.ignoreRules,
      ...this.parseIgnorePatterns(patterns)
    ];
  }

  /**
   * Processes files in batches for memory efficiency
   */
  public async ingestInBatches(files: FileInput[]): Promise<IngestionResult> {
    const startTime = performance.now();
    
    const metrics: IngestionMetrics = {
      fileCount: 0,
      totalBytes: 0,
      parseTimeMs: 0,
      ignoredFileCount: 0,
      binaryFileCount: 0,
      directoryCount: 0
    };

    const allValidFiles: FileInput[] = [];

    // Process in batches
    for (let i = 0; i < files.length; i += this.batchSize) {
      const batch = files.slice(i, i + this.batchSize);
      const validBatch = this.filterAndValidateFiles(batch, metrics);
      allValidFiles.push(...validBatch);

      // Allow event loop to process
      if (i % (this.batchSize * 10) === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    // Build tree and DAG
    const treeRoot = this.buildDirectoryTree(allValidFiles);
    const rootNode = this.treeNodeToDAGNode(treeRoot, metrics);

    metrics.parseTimeMs = performance.now() - startTime;

    return {
      rootNode,
      metrics
    };
  }

  /**
   * Gets statistics about current ignore rules
   */
  public getIgnoreStats(): { ruleCount: number; patterns: string[] } {
    return {
      ruleCount: this.ignoreRules.length,
      patterns: this.ignoreRules.map(r => r.source)
    };
  }
}
