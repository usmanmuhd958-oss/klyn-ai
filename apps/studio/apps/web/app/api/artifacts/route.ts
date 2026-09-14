import { NextResponse } from "next/server";

import {
  getAuthenticatedUser,
  verifyProjectOwnership,
} from "../../../lib/auth/server";
import { supabaseAdmin } from "../../../lib/db/client";

interface ArtifactRequest {
  projectId: string;
  filename: string;
  language: string;
  content: string;
  agentSource?: string;
}

interface DeleteArtifactRequest {
  projectId: string;
  artifactId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateArtifact(body: unknown): body is ArtifactRequest {
  if (!isRecord(body)) {
    return false;
  }

  return (
    typeof body.projectId === "string" &&
    body.projectId.length > 0 &&
    typeof body.filename === "string" &&
    body.filename.length > 0 &&
    typeof body.language === "string" &&
    body.language.length > 0 &&
    typeof body.content === "string" &&
    (body.agentSource === undefined || typeof body.agentSource === "string")
  );
}

function validateDeleteArtifact(
  body: unknown
): body is DeleteArtifactRequest {
  if (!isRecord(body)) {
    return false;
  }

  return (
    typeof body.projectId === "string" &&
    body.projectId.length > 0 &&
    typeof body.artifactId === "string" &&
    body.artifactId.length > 0
  );
}

async function authorizeProject(projectId: string) {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      userId: null,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  const owned = await verifyProjectOwnership(user.id, projectId);

  if (!owned) {
    return {
      userId: null,
      response: NextResponse.json(
        { error: "Project access denied" },
        { status: 403 }
      ),
    };
  }

  return { userId: user.id, response: null };
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

/**
 * Deletes an artifact only after project ownership is verified.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();

    if (!validateDeleteArtifact(body)) {
      return NextResponse.json(
        { error: "Invalid delete payload" },
        { status: 400 }
      );
    }

    const authorization = await authorizeProject(body.projectId);
    if (authorization.response) {
      return authorization.response;
    }

    const { data, error } = await supabaseAdmin
      .from("artifacts")
      .delete()
      .eq("id", body.artifactId)
      .eq("project_id", body.projectId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Artifact deletion error", error);
    return NextResponse.json(
      { error: "Unable to delete artifact" },
      { status: 500 }
    );
  }
}
