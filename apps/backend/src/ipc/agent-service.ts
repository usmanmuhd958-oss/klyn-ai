import type { ExecutionRequest, ExecutionResult } from "@klyn/execution-runtime";

export interface AgentExecutionRequest {
  readonly executionId: string;
  readonly treeId: string;
  readonly agentId: string;
  readonly request: ExecutionRequest;
}

export interface AgentExecutionResponse {
  readonly executionId: string;
  readonly result: ExecutionResult;
}

export interface AgentSandboxService {
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResponse>;
}

export interface AgentEventEnvelope {
  readonly executionId: string;
  readonly type: "token" | "progress" | "checkpoint" | "completed" | "failed" | "cancelled";
  readonly payload: unknown;
}

export interface AgentEventSink {
  publish(event: AgentEventEnvelope): Promise<void>;
}

export class AsyncAgentIpc {
  constructor(private readonly service: AgentSandboxService) {}

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResponse> {
    return this.service.execute(request);
  }
}

/** Transport-neutral contract: a gRPC implementation can bind these methods later without changing callers. */
export interface AgentIpcTransport {
  call(request: AgentExecutionRequest): Promise<AgentExecutionResponse>;
  subscribe(sink: AgentEventSink): () => void;
}
