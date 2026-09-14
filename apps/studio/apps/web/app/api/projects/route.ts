import { NextResponse } from "next/server";

import { supabaseAdmin } from "../../../lib/db/client";
import { getAuthenticatedUser } from "../../../lib/auth/server";

interface CreateProjectRequest {
  name: string;
  description?: string;
}

function validateProject(body: unknown): body is CreateProjectRequest {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const data = body as Record<string, unknown>;
  return (
    typeof data.name === "string" &&
    data.name.trim().length > 0 &&
    (data.description === undefined || typeof data.description === "string")
  );
}

/**
 * Creates a new Klyn project.
 * Identity is always derived from the authenticated server-side session.
 */
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser();

  if (!auth.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    if (!validateProject(body)) {
      return NextResponse.json(
        { error: "Invalid project payload" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: auth.user.id,
        name: body.name.trim(),
        description: body.description?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Project creation failed", error);
    return NextResponse.json(
      { error: "Unable to create project" },
      { status: 500 }
    );
  }
}
