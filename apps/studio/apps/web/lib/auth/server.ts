import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { supabaseAdmin } from "../db/client";

/**
 * Resolve the authenticated Supabase user from the server-managed session.
 *
 * Security invariant: callers must never accept a user id supplied by the
 * request body, query string, or other client-controlled input as identity.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // Route handlers may not always expose a mutable cookie store.
              // The auth lookup itself remains valid.
            }
          },
        },
      }
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.error("Authentication lookup failed", error);
      return null;
    }

    return user ?? null;
  } catch (error) {
    console.error("Authentication primitive failed", error);
    return null;
  }
}

/**
 * Verify that an authenticated user owns the requested project.
 *
 * Security invariant: project ownership is established only by the server-side
 * query WHERE projects.id = projectId AND projects.user_id = userId.
 */
export async function verifyProjectOwnership(
  userId: string,
  projectId: string
): Promise<boolean> {
  if (!userId || !projectId) {
    return false;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Project ownership check failed", error);
      return false;
    }

    return data !== null;
  } catch (error) {
    console.error("Project ownership primitive failed", error);
    return false;
  }
}
