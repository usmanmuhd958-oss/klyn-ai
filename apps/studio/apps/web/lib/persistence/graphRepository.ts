import { supabase } from "@/lib/supabase/client";
import type { Node, Edge } from "@xyflow/react";

export interface SpatialNodeRecord {
  id?: string;
  projectId: string;
  nodeId: string;
  nodeType: string;
  positionX: number;
  positionY: number;
  data: Record<string, unknown>;
}

export interface SpatialEdgeRecord {
  id?: string;
  projectId: string;
  edgeId: string;
  sourceNode: string;
  targetNode: string;
  metadata?: Record<string, unknown>;
}

function mapNode(node: Node, projectId: string): SpatialNodeRecord {
  return {
    projectId,
    nodeId: node.id,
    nodeType: node.type ?? "default",
    positionX: node.position.x,
    positionY: node.position.y,
    data: (node.data as Record<string, unknown>) ?? {},
  };
}

function mapEdge(edge: Edge, projectId: string): SpatialEdgeRecord {
  return {
    projectId,
    edgeId: edge.id,
    sourceNode: edge.source,
    targetNode: edge.target,
    metadata: (edge.data as Record<string, unknown>) ?? {},
  };
}

export class GraphRepository {
  /**
   * Saves or updates a canvas node.
   */
  async saveNode(node: Node, projectId: string): Promise<void> {
    const record = mapNode(node, projectId);

    const { error } = await supabase
      .from("spatial_nodes")
      .upsert(
        {
          project_id: record.projectId,
          node_id: record.nodeId,
          node_type: record.nodeType,
          position_x: record.positionX,
          position_y: record.positionY,
          data_json: record.data,
        },
        {
          onConflict: "project_id,node_id",
        }
      );

    if (error) {
      throw error;
    }
  }

  /**
   * Saves or updates a canvas edge.
   */
  async saveEdge(edge: Edge, projectId: string): Promise<void> {
    const record = mapEdge(edge, projectId);

    const { error } = await supabase
      .from("spatial_edges")
      .upsert(
        {
          project_id: record.projectId,
          edge_id: record.edgeId,
          source_node: record.sourceNode,
          target_node: record.targetNode,
          metadata_json: record.metadata ?? {},
        },
        {
          onConflict: "project_id,edge_id",
        }
      );

    if (error) {
      throw error;
    }
  }

  /**
   * Loads complete spatial graph.
   */
  async loadGraph(projectId: string): Promise<{ nodes: Node[]; edges: Edge[] }> {
    const nodesResult = await supabase
      .from("spatial_nodes")
      .select("*")
      .eq("project_id", projectId);

    const edgesResult = await supabase
      .from("spatial_edges")
      .select("*")
      .eq("project_id", projectId);

    if (nodesResult.error || edgesResult.error) {
      throw nodesResult.error ?? edgesResult.error;
    }

    const nodes: Node[] = nodesResult.data.map((item) => ({
      id: item.node_id,
      type: item.node_type,
      position: {
        x: item.position_x,
        y: item.position_y,
      },
      data: item.data_json,
    }));

    const edges: Edge[] = edgesResult.data.map((item) => ({
      id: item.edge_id,
      source: item.source_node,
      target: item.target_node,
      data: item.metadata_json,
    }));

    return {
      nodes,
      edges,
    };
  }

  /**
   * Deletes all graph data for a project.
   */
  async clearProjectGraph(projectId: string): Promise<void> {
    await supabase
      .from("spatial_nodes")
      .delete()
      .eq("project_id", projectId);

    await supabase
      .from("spatial_edges")
      .delete()
      .eq("project_id", projectId);
  }
}

export const graphRepository = new GraphRepository();
