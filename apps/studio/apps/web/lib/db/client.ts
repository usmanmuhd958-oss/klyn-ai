import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
}

if (!supabaseServiceKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
}

/**
 * Server-side Supabase client.
 * This client must never be exposed to browser components.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export interface DatabaseResult<T> {
  data: T | null;
  error: Error | null;
}

export async function dbQuery<T>(
  query: Promise<{ data: T | null; error: any }>
): Promise<DatabaseResult<T>> {
  try {
    const result = await query;

    if (result.error) {
      return {
        data: null,
        error: new Error(result.error.message),
      };
    }

    return {
      data: result.data,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error
          : new Error("Database operation failed"),
    };
  }
}

/**
 * Execute database transaction style operations via Supabase RPC.
 */
export async function executeRPC<T>(
  functionName: string,
  parameters?: Record<string, unknown>
): Promise<DatabaseResult<T>> {
  return dbQuery(supabaseAdmin.rpc(functionName, parameters));
}
