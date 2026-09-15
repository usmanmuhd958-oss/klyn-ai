import type { ExecutableTask, ExecutableTaskBatch, PlannerBridgeResult, PlannerTaskStatus } from "./planner-bridge.types.js";

export type SpatialNodeStatus = PlannerTaskStatus | "queued" | "executing";

export type SpatialBusEventType =
  | "execution:started"
  | "node:queued"
  | "node:executing"
  | "node:completed"
  | "node:failed"
  | "execution:completed"
  | "execution:failed"
  | "execution:closed";

export interface SpatialCanvasNodeState {
  readonly taskId: string;
  readonly status: SpatialNodeStatus;
  readonly phase: number;
  readonly prerequisites: readonly string[];
  readonly completedPrerequisites: readonly string[];
  readonly executionId: string;
  readonly namespace: string;
  readonly sequence: number;
  readonly error?: string;
}

export interface SpatialBusEvent {
  readonly id: string;
  readonly sequence: number;
  readonly type: SpatialBusEventType;
  readonly executionId: string;
  readonly namespace: string;
  readonly taskId?: string;
  readonly phase?: number;
  readonly state?: SpatialCanvasNodeState;
  readonly error?: string;
}

export interface SpatialExecutionBusOptions {
  readonly namespace?: string;
  readonly maxBufferedEvents?: number;
}

export interface SpatialRuntimeStream {
  readonly executionId: string;
  readonly namespace: string;
  readonly events: readonly SpatialBusEvent[];
  subscribe(listener: SpatialRuntimeListener): () => void;
  close(): void;
}

export type SpatialRuntimeListener = (event: SpatialBusEvent) => void;

export type SpatialTaskExecutor = (task: ExecutableTask) => void | Promise<void>;

export interface SpatialExecutionInput extends PlannerBridgeResult {
  readonly batches: readonly ExecutableTaskBatch[];
}

export type SpatialBusErrorCode =
  | "SPATIAL_BUS_INVALID_INPUT"
  | "SPATIAL_BUS_DUPLICATE_EXECUTION"
  | "SPATIAL_BUS_MISSING_NODE"
  | "SPATIAL_BUS_INVALID_TRANSITION"
  | "SPATIAL_BUS_PREREQUISITE_INCOMPLETE"
  | "SPATIAL_BUS_EXECUTION_CLOSED"
  | "SPATIAL_BUS_BUFFER_LIMIT";

export class SpatialBusError extends Error {
  public readonly code: SpatialBusErrorCode;

  public constructor(code: SpatialBusErrorCode, message: string) {
    super(message);
    this.name = "SpatialBusError";
    this.code = code;
  }
}
