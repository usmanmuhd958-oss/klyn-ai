import { createConnection, createServer, type Server, type Socket } from "node:net";
import type {
  AgentEventSink,
  AgentExecutionRequest,
  AgentExecutionResponse,
  AgentIpcTransport,
  AgentSandboxService,
} from "./agent-service.js";
import {
  AgentEventEnvelopeSchema,
  AgentExecutionRequestSchema,
  AgentExecutionResponseSchema,
  JsonRpcExecuteParamsSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./json-rpc-schemas.js";
import { jsonLogger } from "./json-logger.js";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type ClosableServer = Server & { closeAllConnections(): void };

/** Newline-delimited JSON-RPC 2.0 transport for a local Klyn agent service. */
export class JsonRpcAgentIpcTransport implements AgentIpcTransport {
  private readonly pending = new Map<JsonRpcId, { resolve: (value: AgentExecutionResponse) => void; reject: (error: Error) => void }>();
  private readonly sinks = new Set<AgentEventSink>();
  private socket: Socket | undefined;
  private nextId = 1;
  private buffer = "";
  private readonly connect: () => Socket;

  constructor(connect: () => Socket);
  constructor(host: string, port: number);
  constructor(connectOrHost: (() => Socket) | string, port?: number) {
    this.connect = typeof connectOrHost === "function"
      ? connectOrHost
      : () => createConnection({ host: connectOrHost, port: port ?? 0 });
  }

  call(request: AgentExecutionRequest): Promise<AgentExecutionResponse> {
    const id = this.nextId++;
    return new Promise<AgentExecutionResponse>((resolve, reject) => {
      try {
        const validatedRequest = AgentExecutionRequestSchema.parse(request);
        jsonLogger.info("rpc_request", { id, method: "execute", executionId: validatedRequest.executionId });
        this.pending.set(id, { resolve, reject });
        const socket = this.ensureSocket();
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "execute", params: validatedRequest })}\n`);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  subscribe(sink: AgentEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  close(): void {
    this.failPending(new Error("JSON-RPC transport closed"));
    this.socket?.destroy();
    this.socket = undefined;
    this.buffer = "";
    jsonLogger.info("transport_closed");
  }

  private ensureSocket(): Socket {
    if (this.socket && !this.socket.destroyed) return this.socket;
    const socket = this.connect();
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.consume(chunk));
    socket.on("close", () => this.failPending(new Error("JSON-RPC socket closed")));
    socket.on("error", (error) => this.failPending(error instanceof Error ? error : new Error(String(error))));
    return socket;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      jsonLogger.error("rpc_response_parse_error");
      return;
    }

    if (typeof raw === "object" && raw !== null && "method" in raw && raw.method === "event") {
      const params = "params" in raw ? raw.params : undefined;
      const event = AgentEventEnvelopeSchema.safeParse(params);
      if (!event.success) {
        jsonLogger.error("rpc_event_validation_error", { issues: event.error.issues });
        return;
      }
      void Promise.all([...this.sinks].map((sink) => sink.publish(event.data))).catch((error: unknown) => {
        jsonLogger.error("rpc_event_sink_error", { error: error instanceof Error ? error.message : String(error) });
      });
      return;
    }

    const parsed = JsonRpcResponseSchema.safeParse(raw);
    if (!parsed.success) {
      jsonLogger.error("rpc_response_validation_error", { issues: parsed.error.issues });
      return;
    }

    const message = parsed.data;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if ("error" in message) {
      jsonLogger.error("rpc_response_error", { id: message.id, code: message.error.code, message: message.error.message });
      pending.reject(new Error(message.error.message));
    } else {
      jsonLogger.info("rpc_response", { id: message.id, method: "execute", executionId: message.result.executionId });
      pending.resolve(message.result);
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.socket = undefined;
  }
}

/** Starts a newline-delimited JSON-RPC server over loopback TCP or a Unix socket. */
export async function startJsonRpcAgentIpcServer(
  service: AgentSandboxService,
  options: { host?: string; port?: number; socketPath?: string } = {},
): Promise<Server> {
  const server = createServer((socket) => {
    socket.on("error", (error) => {
      jsonLogger.error("rpc_socket_error", { error: error.message });
    });

    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) void handleRequest(socket, service, line);
        newline = buffer.indexOf("\n");
      }
    });
  });

  if (options.socketPath) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.socketPath, () => { server.off("error", reject); resolve(); });
    });
  } else {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  }

  jsonLogger.info("rpc_server_started", { address: server.address() });
  return server;
}

/** Deterministically stops the RPC server and immediately tears down active sockets. */
export async function closeJsonRpcAgentIpcServer(server: Server): Promise<void> {
  (server as ClosableServer).closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  jsonLogger.info("rpc_server_closed");
}

async function handleRequest(socket: Socket, service: AgentSandboxService, line: string): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    writeResponse(socket, { jsonrpc: "2.0", id: 0, error: { code: PARSE_ERROR, message: "Parse error" } });
    return;
  }

  const requestResult = JsonRpcRequestSchema.safeParse(raw);
  if (!requestResult.success) {
    writeResponse(socket, { jsonrpc: "2.0", id: 0, error: { code: INVALID_REQUEST, message: "Invalid Request", data: requestResult.error.issues } });
    return;
  }

  const request: JsonRpcRequest = requestResult.data;
  jsonLogger.info("rpc_request_received", { id: request.id, method: request.method });

  if (request.method !== "execute") {
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, error: { code: METHOD_NOT_FOUND, message: "Method not found" } });
    return;
  }

  const paramsResult = JsonRpcExecuteParamsSchema.safeParse(request.params);
  if (!paramsResult.success) {
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, error: { code: INVALID_PARAMS, message: "Invalid params", data: paramsResult.error.issues } });
    return;
  }

  try {
    const result = await service.execute(paramsResult.data);
    const validatedResult = AgentExecutionResponseSchema.parse(result);
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, result: validatedResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    jsonLogger.error("rpc_request_error", { id: request.id, error: message });
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, error: { code: INTERNAL_ERROR, message } });
  }
}

function writeResponse(socket: Socket, response: JsonRpcResponse): void {
  const validatedResponse = JsonRpcResponseSchema.parse(response);
  if (!socket.destroyed) socket.write(`${JSON.stringify(validatedResponse)}\n`);
}
