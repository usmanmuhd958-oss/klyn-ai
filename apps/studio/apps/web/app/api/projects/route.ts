import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CreateProjectRequest {
  userId: string;
  name: string;
  description?: string;
}

function validateProject(body: unknown): body is CreateProjectRequest {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const data = body as Record<string, unknown>;
  return (
    typeof data.userId === "string" &&
    typeof data.name === "string" &&
    data.name.length > 0
  );
}

/**
 * Creates a new Klyn project.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!validateProject(body)) {
      return NextResponse.json(
        { error: "Invalid project payload" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: body.userId,
        name: body.name,
        description: body.description ?? null,
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
