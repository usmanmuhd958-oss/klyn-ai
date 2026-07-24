export class SupabaseBridge {
    url;
    anonKey;
    constructor(config = {}) {
        this.url = config.url || process.env.SUPABASE_URL || 'https://localhost:54321';
        this.anonKey = config.anonKey || process.env.SUPABASE_ANON_KEY || 'mock-key';
    }
    from(table) {
        return {
            tableName: table,
            endpoint: this.url,
            key: this.anonKey,
            select: async () => ({ data: [], error: null }),
            insert: async (data) => ({ data, error: null }),
            update: async (data) => ({ data, error: null }),
            delete: async () => ({ data: null, error: null })
        };
    }
}
let supabaseInstance = null;
export function getSupabase(config) {
    if (!supabaseInstance) {
        supabaseInstance = new SupabaseBridge(config);
    }
    return supabaseInstance;
}
