export type GraphEdgeType =
  | "depends-on"
  | "imports"
  | "calls"
  | "extends";

export interface GraphEdge {

  id: string;

  source: string;

  target: string;

  type: GraphEdgeType;

  metadata?: Record<string, unknown>;

}
