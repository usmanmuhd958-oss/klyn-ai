import { NextResponse } from "next/server";

import { getAuthenticatedUser, verifyProjectOwnership } from "../../../lib/auth/server";
import { supabaseAdmin } from "../../../lib/db/client";

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
    data.projectId.length > 0 &&
    typeof data.filename === "string" &&
    data.filename.length > 0 &&
    typeof data.language === "string" &&
    data.language.length > 0 &&
    typeof data.content === "string" &&
    (data.agentSource === undefined || typeof data.agentSource === "string")
  );
}

async function authorizeProject(projectId: string) {
  const auth = await getAuthenticatedUser();

  if (!auth.user) {
    return {
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
      userId: null,
    };
  }

  const ownership = await verifyProjectOwnership(projectId, auth.user.id);

  if (!ownership.authorized) {
    if (ownership.reason === "DATABASE_ERROR") {
      return {
        response: NextResponse.json(
          { error: "Unable to authorize project" },
          { status: 500 }
        ),
        userId: null,
      };
    }

    return {
      response: NextResponse.json(
        { error: "Project access denied" },
        { status: 403 }
      ),
      userId: null,
    };
  }

  return { response: null, userId: auth.user.id };
}

/**
 * Stores generated AI artifacts.
 * Project access is verified against the authenticated user before writing.
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

    const authorization = await authorizeProject(body.projectId);
    if (authorization.response) {
      return authorization.response;
    }

    const { data, error } = await supabaseAdmin
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
 * Loads artifacts for a project after ownership verification.
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

    const authorization = await authorizeProject(projectId);
    if (authorization.response) {
      return authorization.response;
    }

    const { data, error } = await supabaseAdmin
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId);

    if (error) {
      throw error;
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Artifact load error", error);
    return NextResponse.json(
      { error: "Unable to load artifacts" },
      { status: 500 }
    );
  }
}
