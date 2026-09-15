import { createServer, type Server, type Socket } from "node:net";
import type {
  AgentEventEnvelope,
  AgentEventSink,
  AgentExecutionRequest,
  AgentExecutionResponse,
  AgentIpcTransport,
  AgentSandboxService,
} from "./agent-service.js";

type JsonRpcId = string | number;
type JsonRpcRequest = { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Newline-delimited JSON-RPC 2.0 transport for a local Klyn agent service. */
export class JsonRpcAgentIpcTransport implements AgentIpcTransport {
  private readonly pending = new Map<JsonRpcId, { resolve: (value: AgentExecutionResponse) => void; reject: (error: Error) => void }>();
  private readonly sinks = new Set<AgentEventSink>();
  private socket: Socket | undefined;
  private nextId = 1;
  private buffer = "";

  constructor(private readonly connect: () => Socket) {}

  call(request: AgentExecutionRequest): Promise<AgentExecutionResponse> {
    const id = this.nextId++;
    return new Promise<AgentExecutionResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const socket = this.ensureSocket();
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "execute", params: request })}\n`);
    });
  }

  subscribe(sink: AgentEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
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
    let message: JsonRpcResponse & { method?: string; params?: unknown };
    try { message = JSON.parse(line) as typeof message; } catch { return; }
    if ("method" in message && message.method === "event") {
      const event = message.params as AgentEventEnvelope;
      void Promise.all([...this.sinks].map((sink) => sink.publish(event)));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if ("error" in message) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result as AgentExecutionResponse);
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
  return server;
}

async function handleRequest(socket: Socket, service: AgentSandboxService, line: string): Promise<void> {
  let request: JsonRpcRequest;
  try { request = JSON.parse(line) as JsonRpcRequest; }
  catch { writeResponse(socket, { jsonrpc: "2.0", id: 0, error: { code: PARSE_ERROR, message: "Parse error" } }); return; }
  if (request.jsonrpc !== "2.0" || request.id === undefined || typeof request.method !== "string") {
    writeResponse(socket, { jsonrpc: "2.0", id: request.id ?? 0, error: { code: INVALID_REQUEST, message: "Invalid Request" } }); return;
  }
  if (request.method !== "execute") {
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, error: { code: METHOD_NOT_FOUND, message: "Method not found" } }); return;
  }
  try {
    const result = await service.execute(request.params as AgentExecutionRequest);
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    writeResponse(socket, { jsonrpc: "2.0", id: request.id, error: { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : "Internal error" } });
  }
}

function writeResponse(socket: Socket, response: JsonRpcResponse): void { socket.write(`${JSON.stringify(response)}\n`); }
