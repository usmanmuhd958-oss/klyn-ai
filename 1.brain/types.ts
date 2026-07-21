/**
 * KLYN AI OS - Brain Layer Types
 * Production-Grade Type System for Multi-Model Orchestration
 */

export type ModelProvider = 'anthropic' | 'openai' | 'deepseek' | 'google';

export type ModelName = 
  | 'claude-fable-5'           // Claude Opus successor (2026)
  | 'gpt-5.6-sol'              // GPT-5 series
  | 'deepseek-v4-pro'          // Cost-optimized powerhouse
  | 'gemini-3.5-pro';          // Extended context specialist

export type TaskType =
  | 'agentic_coding'           // Autonomous code generation
  | 'refactoring'              // Complex codebase refactoring
  | 'architecture'             // System design
  | 'code_inspection'          // Fast code review
  | 'test_generation'          // Unit/integration test creation
  | 'log_analysis'             // Error log parsing
  | 'dependency_mapping'       // Cross-repo analysis
  | 'self_healing'             // Autonomous bug fixing
  | 'general';                 // General purpose

export interface ModelCapability {
  provider: ModelProvider;
  modelName: ModelName;
  apiModelId: string;          // Actual API model identifier
  strengths: TaskType[];
  contextWindow: number;       // Max tokens
  costPerMToken: number;       // Cost per million tokens (input)
  costPerMTokenOutput: number; // Cost per million tokens (output)
  requestsPerMinute: number;   // Rate limit
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
}

export interface LLMRequest {
  prompt: string;
  taskType?: TaskType;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
  images?: string[];          // Base64 or URLs
  tools?: Tool[];
  preferredModel?: ModelName;
  fallbackChain?: ModelName[];
  metadata?: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  model: ModelName;
  provider: ModelProvider;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  };
  finishReason: 'stop' | 'length' | 'tool_use' | 'error';
  toolCalls?: ToolCall[];
  latencyMs: number;
  cached?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  delta: string;
  model: ModelName;
  isComplete: boolean;
  usage?: LLMResponse['usage'];
  cost?: LLMResponse['cost'];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface CostMetrics {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  costByModel: Record<ModelName, number>;
  costByTask: Record<TaskType, number>;
  averageLatency: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface ProviderError extends Error {
  provider: ModelProvider;
  model: ModelName;
  statusCode?: number;
  retryable: boolean;
  rateLimitReset?: Date;
}
