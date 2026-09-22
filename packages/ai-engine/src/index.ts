export type {
  ProviderName,
  ProviderRequest,
  ProviderResponse,
  ProviderUsage,
  ProviderAdapter,
  StreamChunk,
} from "./providers/types.js";

export type {
  ProviderType,
  ModelCapability,
} from "./providers/registry.js";

export {
  getModelCapability,
  listModelCapabilities,
  registerModelCapability,
  registerModelCapabilities,
} from "./providers/registry.js";

export { ProviderError } from "./providers/http.js";

export { OpenAIAdapter } from "./providers/openai.js";
export { AnthropicAdapter } from "./providers/anthropic.js";
export { GeminiAdapter } from "./providers/gemini.js";
export { OllamaAdapter } from "./providers/ollama.js";
export {
  UniversalChatAdapter,
  createUniversalAdapter,
} from "./providers/universal.js";

export {
  createBuiltinProvider,
  createDefaultBuiltinProvider,
} from "./providers/builtins.js";

export type {
  BuiltinProviderConfig,
} from "./providers/builtins.js";

export { ReplicateAdapter } from "./providers/replicate.js";

export { AIProviderRouter } from "./router.js";

export {
  ProviderCircuitBreaker,
  ProviderCircuitOpenError,
} from "./circuit-breaker.js";

export type {
  CircuitBreakerOptions,
} from "./circuit-breaker.js";

export {
  streamToSSE,
  sseHeaders,
} from "./sse.js";

export type {
  RouteTarget,
  RouterOptions,
  Telemetry,
} from "./router.js";

export {
  RouterPipeline,
  CompletionRequestSchema,
  CompletionResponseSchema,
  TokenUsageSchema,
} from "./provider-router.js";

export type {
  CompletionRequest,
  CompletionResponse,
  RetryPolicy,
  RouterProvider,
  RouterMetrics,
} from "./provider-router.js";

export {
  FallbackRouter,
  CircuitBreaker,
} from "./fallback-router.js";

export type {
  FallbackProvider,
  FallbackPolicy,
  FallbackAttempt,
  FallbackTelemetry,
} from "./fallback-router.js";

export { TokenTelemetryStreamer } from "./token-telemetry-streamer.js";

export { AutonomyBudgetFeed } from "./autonomy-budget-feed.js";
export type { AutonomyBudgetFeedOptions } from "./autonomy-budget-feed.js";

export type {
  TokenTelemetry,
  TokenCounter,
} from "./token-telemetry-streamer.js";

export {
  AgentSwarmCoordinator,
} from "./swarm/coordinator.js";

export type {
  AgentTask,
  AgentResult,
  SwarmOptions,
} from "./swarm/coordinator.js";

export { EphemeralContext } from "./memory/context.js";

export type {
  ContextMessage,
} from "./memory/context.js";

export {
  ContextBudgetManager,
  ContextCompactor,
  ContextControlPlane,
  distillSubagentResult,
} from "./context-control-plane.js";

export type {
  ContextRole,
  ContextMessage as ControlPlaneContextMessage,
  ExecutionNote,
  ContextBudget,
  ContextSnapshot,
  Compactor,
  SubagentResult,
} from "./context-control-plane.js";

export {
  DistributedEventBridge,
  InMemoryDurableEventTransport,
} from "./distributed-event-transport.js";

export type {
  DistributedEvent,
  EventDelivery,
  DurableEventTransport,
  EventBusLike,
  DistributedEventBridgeOptions,
} from "./distributed-event-transport.js";

export {
  ContextEmbeddingEngine,
  DeterministicEmbeddingProvider,
  VectorMemoryIndex,
  CrossAgentKnowledgeBus,
  cosineSimilarity,
} from "./vector-memory.js";

export type {
  EmbeddingProvider,
  EmbeddingRecord,
  VectorSearchResult,
  KnowledgeItem,
} from "./vector-memory.js";

export { TaskGraphPlanner } from "./planner/task-graph-planner.js";

export type {
  ExecutionDependencyMap,
  PlannerConstraint,
  TaskEdge,
  TaskGraphNode,
  TaskGraphPlan,
  TaskGraphPlanRequest,
  TaskGraphPlannerErrorCode,
} from "./types/task-graph.types.js";

export {
  TaskGraphPlannerError,
} from "./types/task-graph.types.js";

export {
  GoalDecompositionEngine,
} from "./planner/goal-decomposition-engine.js";

export type {
  DecomposedTaskNode,
  GoalDecompositionRequest,
  GoalDecompositionResult,
  GoalDecomposerErrorCode,
} from "./types/goal-decomposition.types.js";

export {
  GoalDecomposerError,
} from "./types/goal-decomposition.types.js";

export {
  PlannerBridge,
} from "./orchestrator/planner-bridge.js";

export type {
  ExecutableTask,
  ExecutableTaskBatch,
  PlannerBridgeErrorCode,
  PlannerBridgeOptions,
  PlannerBridgeResult,
  PlannerBridgeStateUpdate,
  PlannerRuntimeTaskState,
  PlannerTaskStatus,
} from "./types/planner-bridge.types.js";

export {
  PlannerBridgeError,
  ImmutableTaskStateStore,
} from "./types/planner-bridge.types.js";

export { SpatialBus } from "./runtime/spatial-bus.js";

export {
  SupabasePlannerStateStore,
} from "./runtime/supabase-planner-state-store.js";

export { SpatialBusError } from "./types/spatial-bus.types.js";
export {
  PlannerStateConflictError,
} from "./types/planner-persistence.types.js";

export type {
  SpatialBusErrorCode,
  SpatialBusEvent,
  SpatialBusEventType,
  SpatialCanvasNodeState,
  SpatialExecutionBusOptions,
  SpatialExecutionInput,
  SpatialNodeStatus,
  SpatialRuntimeListener,
  SpatialRuntimeStream,
  SpatialTaskExecutor,
} from "./types/spatial-bus.types.js";

export type {
  PlannerStateCompareAndSwapInput,
  PlannerStatePersistence,
  PlannerStatePersistenceConfig,
  PlannerStatePersistenceRow,
} from "./types/planner-persistence.types.js";

export {
  AiEngine,
  ProviderHealthTracker,
  TokenCostMeter,
  ContextSelector,
  AiEngineError,
} from "./control-plane/index.js";

export type {
  AiEngineOptions,
  AiEngineErrorCode,
  AiEngineErrorOptions,
  AiEngineProvider,
  AiCompletionRequest,
  AiCompletionResult,
  ContextItem,
  ContextPriority,
  ContextSelectionPolicy,
  ContextSelectionResult,
  MeterStatus,
  ModelCapabilityName,
  ModelDefinition,
  ModelPricing,
  ProviderHealthPolicy,
  ProviderHealthSnapshot,
  ProviderHealthState,
  RoutingObjective,
  RoutingPolicy,
  TokenMeterRecord,
} from "./control-plane/index.js";

export {
  TASK_TYPES,
  DEFAULT_MAX_LATENCY_MS,
  DEFAULT_ROUTING_WEIGHTS,
  ROUTING_SCORE_BPS,
} from "./routing/index.js";

export type {
  TaskType,
  ProviderCostEntry,
  ProviderCostMatrix,
  RoutingWeights,
  ExecutionRequest,
  RouteCandidateInput,
  RouteCandidate,
  RouteDecisionStatus,
  RouteDecision,
} from "./routing/index.js";

export {
  calculateRouteScore,
  compareRouteCandidates,
  scoreRouteCandidate,
  rankRouteCandidates,
  decideRoute,
  providerCostKey,
  findProviderCost,
  estimateCostMicrousd,
} from "./routing/index.js";

export { DynamicProviderRouter } from "./dynamic-provider-router.js";
export type {
  DynamicProviderCandidate,
  DynamicProviderRouterOptions,
  DynamicRoutingObjective,
  DynamicRoutingPolicy,
  DynamicRouteCandidateScore,
  DynamicRouteDecision,
  ProviderHealthSnapshot as DynamicProviderHealthSnapshot,
} from "./dynamic-provider-router.js";
