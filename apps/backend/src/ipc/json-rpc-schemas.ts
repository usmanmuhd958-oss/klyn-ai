import { z } from "zod";

const JsonRpcIdSchema = z.union([z.string().min(1), z.number().finite()]);

const ExecutionRequestSchema = z.object({
  language: z.enum(["javascript", "typescript", "python", "rust"]),
  source: z.string(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  memoryMb: z.number().int().positive().max(16_384).optional(),
}).strict();

export const AgentExecutionRequestSchema = z.object({
  executionId: z.string().min(1).max(256),
  treeId: z.string().min(1).max(256),
  agentId: z.string().min(1).max(256),
  request: ExecutionRequestSchema,
}).strict();

export const AgentExecutionResponseSchema = z.object({
  executionId: z.string().min(1).max(256),
  result: z.object({
    exitCode: z.number().int(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().finite().nonnegative(),
  }).strict(),
}).strict();

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
}).strict();

export const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string().min(1),
  data: z.unknown().optional(),
}).strict();

export const JsonRpcResponseSchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: JsonRpcIdSchema, result: AgentExecutionResponseSchema }).strict(),
  z.object({ jsonrpc: z.literal("2.0"), id: JsonRpcIdSchema, error: JsonRpcErrorSchema }).strict(),
]);

export const JsonRpcExecuteParamsSchema = AgentExecutionRequestSchema;

export type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
