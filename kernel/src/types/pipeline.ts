// kernel/src/types/pipeline.ts
export interface RepoIngestionOptions {
  maxFileSize?: number;
  maxDepth?: number;
  ignorePatterns?: string[];
  includeBinary?: boolean;
  parseAST?: boolean;
}

export interface FileNode {
  path: string;
  hash: string;
  size: number;
  content?: Uint8Array;
  language?: string;
  astCount: number;
}

export interface DirectoryNode {
  path: string;
  hash: string;
  children: Array<FileNode | DirectoryNode>;
  totalSize: number;
  totalFiles: number;
}

export interface IngestionMetrics {
  filesPerSecond: number;
  bytesPerSecond: number;
  avgTimePerFile: number;
  memoryPerFile: number;
  cacheHitRate: number;
}
