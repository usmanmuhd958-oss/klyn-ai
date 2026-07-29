// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// src/types/core.ts
export interface MerkleNode {
  hash: string;
  data: Uint8Array;
  links: string[];
  metadata: NodeMetadata;
}

export interface NodeMetadata {
  path: string;
  size: number;
  mtime: number;
  type: 'file' | 'directory' | 'symlink';
  language?: string;
}

export interface ASTNode {
  id: string;
  type: string;
  name: string;
  range: [number, number];
  dependencies: string[];
  exports: string[];
}

export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, Set<string>>;
}

export interface GraphNode {
  path: string;
  hash: string;
  imports: string[];
  exports: string[];
  astNodes: ASTNode[];
}

export interface IndexStats {
  filesIndexed: number;
  nodesCreated: number;
  totalSize: number;
  indexTime: number;
}
