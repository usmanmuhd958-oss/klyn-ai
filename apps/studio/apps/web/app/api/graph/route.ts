import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface GraphRequest {
  projectId: string;
  nodes: Array<any>;
  edges: Array<any>;
}

function validateGraph(body: unknown): body is GraphRequest {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const data = body as Record<string, unknown>;
  return (
    typeof data.projectId === "string" &&
    Array.isArray(data.nodes) &&
    Array.isArray(data.edges)
  );
}

/**
 * Persists complete spatial graph state.
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

    const nodeRows = body.nodes.map((node) => ({
      project_id: body.projectId,
      node_id: node.id,
      node_type: node.type ?? "default",
      position_x: node.position.x,
      position_y: node.position.y,
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
      const nodeResult = await supabase.from("spatial_nodes").upsert(nodeRows, {
        onConflict: "project_id,node_id",
      });
      if (nodeResult.error) throw nodeResult.error;
    }

    if (edgeRows.length > 0) {
      const edgeResult = await supabase.from("spatial_edges").upsert(edgeRows, {
        onConflict: "project_id,edge_id",
      });
      if (edgeResult.error) throw edgeResult.error;
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
 * Loads complete graph state.
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

  const nodes = await supabase
    .from("spatial_nodes")
    .select("*")
    .eq("project_id", projectId);

  const edges = await supabase
    .from("spatial_edges")
    .select("*")
    .eq("project_id", projectId);

  return NextResponse.json({
    nodes: nodes.data ?? [],
    edges: edges.data ?? [],
  });
}
