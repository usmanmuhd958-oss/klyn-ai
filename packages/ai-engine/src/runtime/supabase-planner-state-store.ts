import {
  PlannerStateConflictError,
  type PlannerStateCompareAndSwapInput,
  type PlannerStatePersistence,
  type PlannerStatePersistenceConfig,
  type PlannerStatePersistenceRow,
} from "../types/planner-persistence.types.js";
import type { PlannerRuntimeTaskState } from "../types/planner-bridge.types.js";

export type PlannerFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

export class SupabasePlannerStateStore implements PlannerStatePersistence {
  readonly #config: PlannerStatePersistenceConfig;
  readonly #fetch: PlannerFetch;

  public constructor(config: PlannerStatePersistenceConfig, fetchImpl: PlannerFetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  public async compareAndSwap(input: PlannerStateCompareAndSwapInput): Promise<PlannerRuntimeTaskState> {
    const endpoint = new URL("/rest/v1/planner_execution_states", this.#config.supabaseUrl);
    endpoint.searchParams.set("execution_id", `eq.${input.executionId}`);
    endpoint.searchParams.set("task_id", `eq.${input.taskId}`);
    endpoint.searchParams.set("owner_user_id", `eq.${this.#config.ownerUserId}`);
    endpoint.searchParams.set("state_version", `eq.${input.expectedStateVersion}`);

    const response = await this.#fetch(endpoint, {
      method: "PATCH",
      headers: {
        apikey: this.#config.apiKey,
        Authorization: `Bearer ${this.#config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: input.status,
        phase: input.phase,
        prerequisites: input.prerequisites,
        completed_prerequisites: input.completedPrerequisites,
        execution_order: input.executionOrder,
        node: input.node,
        metadata: input.metadata ?? {},
        state_version: input.expectedStateVersion + 1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase planner state update failed (${response.status}): ${detail}`);
    }

    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new PlannerStateConflictError(input.taskId, input.expectedStateVersion);
    }
    if (rows.length !== 1) {
      throw new Error(`Supabase planner state CAS returned ${rows.length} rows for task '${input.taskId}'`);
    }

    return this.toRuntimeState(rows[0] as PlannerStatePersistenceRow);
  }

  private toRuntimeState(row: PlannerStatePersistenceRow): PlannerRuntimeTaskState {
    return Object.freeze({
      taskId: row.task_id,
      status: row.status,
      phase: row.phase,
      prerequisites: Object.freeze([...row.prerequisites]),
      completedPrerequisites: Object.freeze([...row.completed_prerequisites]),
      executionId: row.execution_id,
      namespace: row.namespace,
      stateVersion: row.state_version,
    });
  }
}
