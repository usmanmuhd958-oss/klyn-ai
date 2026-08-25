import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ArtifactRequest {
  projectId: string;
  filename: string;
  language: string;
  content: string;
  agentSource?: string;
}

function validateArtifact(body: unknown): body is ArtifactRequest {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const data = body as Record<string, unknown>;
  return (
    typeof data.projectId === "string" &&
    typeof data.filename === "string" &&
    typeof data.language === "string" &&
    typeof data.content === "string"
  );
}

/**
 * Stores generated AI artifacts.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!validateArtifact(body)) {
      return NextResponse.json(
        { error: "Invalid artifact payload" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("artifacts")
      .insert({
        project_id: body.projectId,
        filename: body.filename,
        language: body.language,
        content: body.content,
        agent_source: body.agentSource ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Artifact persistence error", error);
    return NextResponse.json(
      { error: "Unable to save artifact" },
      { status: 500 }
    );
  }
}

/**
 * Loads artifacts for a project.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId);

    if (error) {
      throw error;
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to load artifacts" },
      { status: 500 }
    );
  }
}
