import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { supabaseAdmin } from "../db/client";

export type AuthenticatedUserResult =
  | { user: User; error: null }
  | { user: null; error: "UNAUTHENTICATED" | "AUTHENTICATION_FAILED" };

/**
 * Resolve the authenticated Supabase user from the server-managed session.
 *
 * Security invariant: callers must never accept a user id supplied by the
 * request body, query string, or other client-controlled input as identity.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUserResult> {
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
              // Authentication itself remains valid; middleware is responsible
              // for refreshing session cookies when applicable.
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
      return { user: null, error: "AUTHENTICATION_FAILED" };
    }

    if (!user) {
      return { user: null, error: "UNAUTHENTICATED" };
    }

    return { user, error: null };
  } catch (error) {
    console.error("Authentication primitive failed", error);
    return { user: null, error: "AUTHENTICATION_FAILED" };
  }
}

export type ProjectAuthorizationResult =
  | { authorized: true }
  | { authorized: false; reason: "NOT_FOUND_OR_FORBIDDEN" | "DATABASE_ERROR" };

/**
 * Verify that the authenticated user owns the requested project.
 *
 * This intentionally uses the server-only service-role client for the final
 * ownership check. The project id remains untrusted until this query proves
 * the relationship between project_id and authenticated user_id.
 */
export async function verifyProjectOwnership(
  projectId: string,
  userId: string
): Promise<ProjectAuthorizationResult> {
  if (!projectId || !userId) {
    return { authorized: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
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
      return { authorized: false, reason: "DATABASE_ERROR" };
    }

    if (!data) {
      return { authorized: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }

    return { authorized: true };
  } catch (error) {
    console.error("Project ownership primitive failed", error);
    return { authorized: false, reason: "DATABASE_ERROR" };
  }
}
