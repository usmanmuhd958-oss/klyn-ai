import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface DatabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export function createDatabaseClient(config: DatabaseConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}
