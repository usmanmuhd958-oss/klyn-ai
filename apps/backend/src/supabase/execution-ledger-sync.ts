import { createDatabaseClient } from "@klyn/database";

export type ExecutionStatus = "pending" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export type AgentLogLevel = "debug" | "info" | "warn" | "error";
export type ProviderTelemetryStatus = "success" | "error" | "fallback" | "timeout" | "rate_limited";

export interface SupabaseQueryResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

export interface SupabaseTableQuery {
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }): Promise<SupabaseQueryResult>;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Promise<SupabaseQueryResult>;
}

export interface SupabaseChannel {
  on(
    event: "postgres_changes",
    filter: Record<string, unknown>,
    callback: (payload: RealtimePayload) => void,
  ): SupabaseChannel;
  subscribe(callback?: (status: string) => void): SupabaseChannel;
  unsubscribe(): Promise<unknown>;
}

export interface SupabaseLedgerClient {
  from(table: string): SupabaseTableQuery;
  channel(name: string): SupabaseChannel;
}

export interface RealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

export interface ExecutionStateEvent {
  type: "execution.state";
  executionId: string;
  status: ExecutionStatus;
  dagId?: string;
  metadata?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
}

export interface DagStateEvent {
  type: "dag.state";
  executionId: string;
  dagId: string;
  nodeId: string;
  state: ExecutionStatus;
  attempt: number;
  error?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export interface AgentLogEvent {
  type: "agent.log";
  executionId: string;
  agentId: string;
  level: AgentLogLevel;
  event: string;
  message?: string;
  payload?: Record<string, unknown>;
  sequence?: number;
}

export interface ProviderTelemetryEvent {
  type: "provider.telemetry";
  executionId?: string;
  agentId?: string;
  provider: string;
  model: string;
  attempt: number;
  status: ProviderTelemetryStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs?: number;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export type ExecutionLedgerEvent = ExecutionStateEvent | DagStateEvent | AgentLogEvent | ProviderTelemetryEvent;

export interface LedgerSyncOptions {
  channelName?: string;
  realtimeTables?: string[];
}

export interface LedgerSyncSubscription {
  unsubscribe(): Promise<unknown>;
}

export class SupabaseExecutionLedgerSync {
  private readonly channelName: string;

  constructor(
    private readonly client: SupabaseLedgerClient,
    options: LedgerSyncOptions = {},
  ) {
    this.channelName = options.channelName ?? "klyn-execution-ledger";
  }

  static fromConfig(url: string, serviceRoleKey: string, options: LedgerSyncOptions = {}): SupabaseExecutionLedgerSync {
    return new SupabaseExecutionLedgerSync(
      createDatabaseClient({ url, serviceRoleKey }) as unknown as SupabaseLedgerClient,
      options,
    );
  }

  async publish(event: ExecutionLedgerEvent): Promise<void> {
    switch (event.type) {
      case "execution.state":
        await this.upsertExecution(event);
        return;
      case "dag.state":
        await this.upsertDagState(event);
        return;
      case "agent.log":
        await this.appendAgentLog(event);
        return;
      case "provider.telemetry":
        await this.appendProviderTelemetry(event);
        return;
    }
  }

  async upsertExecution(event: ExecutionStateEvent): Promise<void> {
    await this.assertSuccess(
      this.client.from("executions").upsert(
        {
          execution_id: event.executionId,
          status: event.status,
          dag_id: event.dagId ?? null,
          metadata: event.metadata ?? {},
          started_at: event.startedAt ?? null,
          completed_at: event.completedAt ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "execution_id" },
      ),
      "executions",
    );
  }

  async upsertDagState(event: DagStateEvent): Promise<void> {
    await this.assertSuccess(
      this.client.from("dag_states").upsert(
        {
          execution_id: event.executionId,
          dag_id: event.dagId,
          node_id: event.nodeId,
          state: event.state,
          attempt: event.attempt,
          error: event.error ?? null,
          result: event.result ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "execution_id,node_id" },
      ),
      "dag_states",
    );
  }

  async appendAgentLog(event: AgentLogEvent): Promise<void> {
    await this.assertSuccess(
      this.client.from("agent_logs").insert({
        execution_id: event.executionId,
        agent_id: event.agentId,
        level: event.level,
        event: event.event,
        message: event.message ?? null,
        payload: event.payload ?? {},
        sequence: event.sequence ?? null,
      }),
      "agent_logs",
    );
  }

  async appendProviderTelemetry(event: ProviderTelemetryEvent): Promise<void> {
    await this.assertSuccess(
      this.client.from("provider_telemetry").insert({
        execution_id: event.executionId ?? null,
        agent_id: event.agentId ?? null,
        provider: event.provider,
        model: event.model,
        attempt: event.attempt,
        status: event.status,
        input_tokens: event.inputTokens,
        output_tokens: event.outputTokens,
        total_tokens: event.totalTokens,
        latency_ms: event.latencyMs ?? null,
        error_code: event.errorCode ?? null,
        metadata: event.metadata ?? {},
      }),
      "provider_telemetry",
    );
  }

  subscribe(
    table: "executions" | "dag_states" | "agent_logs" | "provider_telemetry",
    onChange: (payload: RealtimePayload) => void,
  ): LedgerSyncSubscription {
    const channel = this.client
      .channel(`${this.channelName}:${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        onChange,
      )
      .subscribe();

    return {
      unsubscribe: () => channel.unsubscribe(),
    };
  }

  private async assertSuccess(result: Promise<SupabaseQueryResult>, table: string): Promise<void> {
    const response = await result;
    if (response.error) {
      throw new Error(`Supabase ledger write failed for ${table}: ${response.error.message}`);
    }
  }
}
