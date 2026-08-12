export type GraphNodeType =
  | "file"
  | "function"
  | "class"
  | "interface"
  | "variable"
  | "module"
  | "api"
  | "database";

export interface GraphNodeMetadata {
  language?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  exported?: boolean;
  complexity?: number;
}

export interface GraphNode {
  id: string;

  name: string;

  type: GraphNodeType;

  metadata: GraphNodeMetadata;

  createdAt: Date;

  updatedAt: Date;
}

export function createGraphNode(
  id: string,
  name: string,
  type: GraphNodeType,
  metadata: GraphNodeMetadata = {}
): GraphNode {
  return {
    id,
    name,
    type,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
