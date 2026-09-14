import { NextResponse } from "next/server";

import { getAuthenticatedUser, verifyProjectOwnership } from "../../../lib/auth/server";
import { supabaseAdmin } from "../../../lib/db/client";

interface GraphNode {
  id: string;
  type?: string;
  position?: {
    x: number;
    y: number;
  };
  data?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

interface GraphRequest {
  projectId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateGraph(body: unknown): body is GraphRequest {
  if (!isRecord(body)) {
    return false;
  }

  if (
    typeof body.projectId !== "string" ||
    body.projectId.length === 0 ||
    !Array.isArray(body.nodes) ||
    !Array.isArray(body.edges)
  ) {
    return false;
  }

  const validNodes = body.nodes.every((node) => {
    if (!isRecord(node) || typeof node.id !== "string" || node.id.length === 0) {
      return false;
    }

    if (node.type !== undefined && typeof node.type !== "string") {
      return false;
    }

    if (!isRecord(node.position)) {
      return false;
    }

    return (
      typeof node.position.x === "number" &&
      Number.isFinite(node.position.x) &&
      typeof node.position.y === "number" &&
      Number.isFinite(node.position.y) &&
      (node.data === undefined || isRecord(node.data))
    );
  });

  const validEdges = body.edges.every((edge) => {
    if (
      !isRecord(edge) ||
      typeof edge.id !== "string" ||
      edge.id.length === 0 ||
      typeof edge.source !== "string" ||
      edge.source.length === 0 ||
      typeof edge.target !== "string" ||
      edge.target.length === 0
    ) {
      return false;
    }

    return edge.data === undefined || isRecord(edge.data);
  });

  return validNodes && validEdges;
}

async function authorizeProject(projectId: string) {
  const auth = await getAuthenticatedUser();

  if (!auth.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const ownership = await verifyProjectOwnership(projectId, auth.user.id);

  if (!ownership.authorized) {
    if (ownership.reason === "DATABASE_ERROR") {
      return NextResponse.json(
        { error: "Unable to authorize project" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Project access denied" },
      { status: 403 }
    );
  }

  return null;
}

/**
 * Persists complete spatial graph state after project ownership verification.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!validateGraph(body)) {
      return NextResponse.json(
        { error: "Invalid graph payload" },
        { status: 400 }
      );
    }

    const authorizationResponse = await authorizeProject(body.projectId);
    if (authorizationResponse) {
      return authorizationResponse;
    }

    const nodeRows = body.nodes.map((node) => ({
      project_id: body.projectId,
      node_id: node.id,
      node_type: node.type ?? "default",
      position_x: node.position!.x,
      position_y: node.position!.y,
      data_json: node.data ?? {},
    }));

    const edgeRows = body.edges.map((edge) => ({
      project_id: body.projectId,
      edge_id: edge.id,
      source_node: edge.source,
      target_node: edge.target,
      metadata_json: edge.data ?? {},
    }));

    if (nodeRows.length > 0) {
      const nodeResult = await supabaseAdmin
        .from("spatial_nodes")
        .upsert(nodeRows, {
          onConflict: "project_id,node_id",
        });

      if (nodeResult.error) {
        throw nodeResult.error;
      }
    }

    if (edgeRows.length > 0) {
      const edgeResult = await supabaseAdmin
        .from("spatial_edges")
        .upsert(edgeRows, {
          onConflict: "project_id,edge_id",
        });

      if (edgeResult.error) {
        throw edgeResult.error;
      }
    }

    return NextResponse.json({
      success: true,
      nodes: body.nodes.length,
      edges: body.edges.length,
    });
  } catch (error) {
    console.error("Graph sync failed", error);
    return NextResponse.json(
      { error: "Unable to sync graph" },
      { status: 500 }
    );
  }
}

/**
 * Loads complete graph state after project ownership verification.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId" },
      { status: 400 }
    );
  }

  try {
    const authorizationResponse = await authorizeProject(projectId);
    if (authorizationResponse) {
      return authorizationResponse;
    }

    const [nodes, edges] = await Promise.all([
      supabaseAdmin
        .from("spatial_nodes")
        .select("*")
        .eq("project_id", projectId),
      supabaseAdmin
        .from("spatial_edges")
        .select("*")
        .eq("project_id", projectId),
    ]);

    if (nodes.error || edges.error) {
      console.error("Graph load failed", nodes.error ?? edges.error);
      return NextResponse.json(
        { error: "Unable to load graph" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      nodes: nodes.data ?? [],
      edges: edges.data ?? [],
    });
  } catch (error) {
    console.error("Graph load failed", error);
    return NextResponse.json(
      { error: "Unable to load graph" },
      { status: 500 }
    );
  }
}
