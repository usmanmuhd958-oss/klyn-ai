import { type PlannerStateCompareAndSwapInput, type PlannerStatePersistence, type PlannerStatePersistenceConfig } from "../types/planner-persistence.types.js";
import type { PlannerRuntimeTaskState } from "../types/planner-bridge.types.js";
export type PlannerFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;
export declare class SupabasePlannerStateStore implements PlannerStatePersistence {
    #private;
    constructor(config: PlannerStatePersistenceConfig, fetchImpl?: PlannerFetch);
    compareAndSwap(input: PlannerStateCompareAndSwapInput): Promise<PlannerRuntimeTaskState>;
    private toRuntimeState;
}
//# sourceMappingURL=supabase-planner-state-store.d.ts.map