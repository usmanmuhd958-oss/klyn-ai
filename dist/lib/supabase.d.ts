export interface SupabaseConfig {
    url?: string;
    anonKey?: string;
}
export declare class SupabaseBridge {
    readonly url: string;
    readonly anonKey: string;
    constructor(config?: SupabaseConfig);
    from(table: string): {
        tableName: string;
        endpoint: string;
        key: string;
        select: () => Promise<{
            data: never[];
            error: null;
        }>;
        insert: (data: unknown) => Promise<{
            data: unknown;
            error: null;
        }>;
        update: (data: unknown) => Promise<{
            data: unknown;
            error: null;
        }>;
        delete: () => Promise<{
            data: null;
            error: null;
        }>;
    };
}
export declare function getSupabase(config?: SupabaseConfig): SupabaseBridge;
//# sourceMappingURL=supabase.d.ts.map