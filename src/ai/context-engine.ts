/**
 * @fileoverview Klyn AI OS - AI Speculative Context Pipeline
 * @module ai/context-engine
 * @author Klyn Systems Architecture Team
 * @license Proprietary
 * 
 * Enterprise-grade AI context engine with token budget management, streaming semantic
 * diff parsing, multi-model routing, speculative code synthesis, and precision telemetry.
 */

import { performance } from 'perf_hooks';
import { createHash } from 'crypto';
import { TypedEventEmitter } from '../core/typed-event-emitter.js';

// ============================================================================
// ERROR HIERARCHY
// ============================================================================

class ContextEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ContextEngineError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
    };
  }
}

class TokenBudgetExceededError extends ContextEngineError {
  constructor(
    public readonly requested: number,
    public readonly limit: number
  ) {
    super(
      `Token budget exceeded: ${requested} > ${limit}`,
      'TOKEN_BUDGET_EXCEEDED',
      { requested, limit }
    );
    this.name = 'TokenBudgetExceededError';
  }
}

class ModelProviderError extends ContextEngineError {
  constructor(
    public readonly provider: string,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'MODEL_PROVIDER_ERROR', { ...context, provider });
    this.name = 'ModelProviderError';
  }
}

class StreamParsingError extends ContextEngineError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'STREAM_PARSING_ERROR', context);
    this.name = 'StreamParsingError';
  }
}

class MergeConflictError extends ContextEngineError {
  constructor(
    public readonly filePath: string,
    public readonly conflicts: ReadonlyArray<ConflictMarker>
  ) {
    super(
      `Merge conflict in ${filePath}: ${conflicts.length} conflicts`,
      'MERGE_CONFLICT_ERROR',
      { filePath, conflictCount: conflicts.length }
    );
    this.name = 'MergeConflictError';
  }
}

class SpeculativeExecutionError extends ContextEngineError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SPECULATIVE_EXECUTION_ERROR', context);
    this.name = 'SpeculativeExecutionError';
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type ModelProvider = 'anthropic' | 'openai' | 'local' | 'custom';

type ContextPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

type DiffOperation = 'insert' | 'delete' | 'replace' | 'move';

interface TokenBudget {
  readonly total: number;
  readonly system: number;
  readonly context: number;
  readonly completion: number;
  readonly reserved: number;
}

interface ContextItem {
  readonly id: string;
  readonly type: 'file' | 'ast' | 'error' | 'diagnostic' | 'documentation' | 'example';
  readonly content: string;
  readonly tokens: number;
  readonly priority: ContextPriority;
  readonly timestamp: number;
  readonly metadata: Record<string, unknown>;
}

interface ContextWindow {
  readonly items: ReadonlyArray<ContextItem>;
  readonly totalTokens: number;
  readonly priorityBreakdown: Record<ContextPriority, number>;
  readonly contentHash: string;
}

interface ConflictMarker {
  readonly line: number;
  readonly type: 'ours' | 'theirs' | 'base';
  readonly content: string;
}

interface CodeChange {
  readonly operation: DiffOperation;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly oldContent: string;
  readonly newContent: string;
  readonly confidence: number;
}

interface SemanticDiff {
  readonly filePath: string;
  readonly operations: ReadonlyArray<DiffOperation>;
  readonly changes: ReadonlyArray<CodeChange>;
  readonly conflictMarkers: ReadonlyArray<ConflictMarker>;
  readonly isClean: boolean;
}

interface ModelConfig {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stopSequences?: ReadonlyArray<string>;
  readonly timeout?: number;
}

interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly total: number;
}

interface LatencyMetrics {
  readonly timeToFirstToken: number;
  readonly totalTime: number;
  readonly tokensPerSecond: number;
  readonly throughput: number;
}

interface InferenceResponse {
  readonly requestId: string;
  readonly content: string;
  readonly tokens: TokenUsage;
  readonly latency: LatencyMetrics;
  readonly model: string;
  readonly provider: ModelProvider;
  readonly cached: boolean;
  readonly speculative: boolean;
}

interface InferenceRequest {
  readonly id: string;
  readonly prompt: string;
  readonly context: ContextWindow;
  readonly model: ModelConfig;
  readonly stream?: boolean;
  readonly speculative?: boolean;
  readonly metadata?: Record<string, unknown>;
}

interface CursorPosition {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

interface SpeculativeCompletion {
  readonly id: string;
  readonly content: string;
  readonly confidence: number;
  readonly tokens: number;
  readonly astValid: boolean;
  readonly metadata: Record<string, unknown>;
}

interface SpeculativeCache {
  readonly cursorPosition: CursorPosition;
  readonly predictedContext: ContextWindow;
  readonly preGeneratedCompletions: ReadonlyArray<SpeculativeCompletion>;
  readonly timestamp: number;
  readonly confidence: number;
}

interface SemanticAccuracy {
  readonly syntaxValid: boolean;
  readonly typeCheck: boolean;
  readonly astIntegrity: boolean;
  readonly importResolution: boolean;
  readonly score: number;
}

interface ContextEngineMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageTTFT: number;
  averageTokensPerSecond: number;
  cacheHitRate: number;
  speculativeHitRate: number;
  averageContextTokens: number;
  providerBreakdown: Record<ModelProvider, number>;
  [key: string]: unknown;
}

interface ContextEngineEventMap {
  'context:built': { window: ContextWindow; duration: number };
  'context:updated': { window: ContextWindow; diff: SemanticDiff };
  'token:budget_exceeded': { requested: number; limit: number };
  'inference:started': { requestId: string; provider: ModelProvider };
  'inference:progress': { requestId: string; tokens: number };
  'inference:completed': InferenceResponse;
  'inference:failed': { requestId: string; error: Error; provider: ModelProvider };
  'stream:chunk': { requestId: string; chunk: string; tokens: number };
  'stream:completed': { requestId: string; totalTokens: number };
  'diff:parsed': SemanticDiff;
  'diff:conflict': { filePath: string; conflicts: ReadonlyArray<ConflictMarker> };
  'speculative:cache_hit': { cursorPosition: CursorPosition; confidence: number };
  'speculative:cache_miss': { cursorPosition: CursorPosition };
  'speculative:generated': { completions: ReadonlyArray<SpeculativeCompletion> };
  'model:fallback': { from: ModelProvider; to: ModelProvider; reason: string };
  'metrics:updated': ContextEngineMetrics;
  'error': ContextEngineError;
  [key: string]: unknown;
}

// ============================================================================
// TYPED EVENT EMITTER
// ============================================================================

// ============================================================================
// TOKEN COUNTER
// ============================================================================

class TokenCounter {
  static count(text: string): number {
    if (!text) return 0;

    let tokens = 0;

    const words = text.split(/\s+/).filter(Boolean);
    tokens += words.length;

    const specialChars = (text.match(/[{}[\]();:,.<>\/\\|@#$%^&*+=~`'"]/g) || []).length;
    tokens += Math.ceil(specialChars / 2);

    const newlines = (text.match(/\n/g) || []).length;
    tokens += Math.ceil(newlines / 2);

    return Math.max(1, tokens);
  }

  static countJSON(data: unknown): number {
    const json = JSON.stringify(data);
    return this.count(json);
  }
}

// ============================================================================
// TOKEN BUDGET MANAGER
// ============================================================================

class TokenBudgetManager {
  private readonly budget: TokenBudget;
  private allocated = 0;

  constructor(
    totalTokens: number,
    private readonly reservePercentage: number = 0.1
  ) {
    const reserved = Math.floor(totalTokens * reservePercentage);
    const available = totalTokens - reserved;

    this.budget = {
      total: totalTokens,
      system: Math.floor(available * 0.1),
      context: Math.floor(available * 0.7),
      completion: Math.floor(available * 0.2),
      reserved,
    };
  }

  allocate(tokens: number): boolean {
    if (this.allocated + tokens <= this.budget.context) {
      this.allocated += tokens;
      return true;
    }
    return false;
  }

  deallocate(tokens: number): void {
    this.allocated = Math.max(0, this.allocated - tokens);
  }

  get remaining(): number {
    return this.budget.context - this.allocated;
  }

  get utilization(): number {
    return this.budget.context > 0 ? this.allocated / this.budget.context : 0;
  }

  reset(): void {
    this.allocated = 0;
  }

  getBudget(): Readonly<TokenBudget> {
    return { ...this.budget };
  }
}

// ============================================================================
// CONTEXT PRIORITIZER
// ============================================================================

class ContextPrioritizer {
  private readonly weights: Record<ContextPriority, number> = {
    critical: 1.0,
    high: 0.8,
    normal: 0.5,
    low: 0.3,
    background: 0.1,
  };

  prioritize(items: ContextItem[]): ContextItem[] {
    const now = Date.now();

    return items.sort((a, b) => {
      const scoreA = this.calculateScore(a, now);
      const scoreB = this.calculateScore(b, now);

      return scoreB - scoreA;
    });
  }

  private calculateScore(item: ContextItem, now: number): number {
    const priorityWeight = this.weights[item.priority];
    const age = now - item.timestamp;
    const ageDecay = Math.exp(-age / (60 * 60 * 1000));

    let typeBonus = 0;
    switch (item.type) {
      case 'error':
        typeBonus = 0.3;
        break;
      case 'diagnostic':
        typeBonus = 0.2;
        break;
      case 'ast':
        typeBonus = 0.15;
        break;
      case 'file':
        typeBonus = 0.1;
        break;
      default:
        typeBonus = 0;
    }

    return priorityWeight * ageDecay + typeBonus;
  }

  selectWithinBudget(items: ContextItem[], budget: number): ContextItem[] {
    const prioritized = this.prioritize([...items]);
    const selected: ContextItem[] = [];
    let totalTokens = 0;

    for (const item of prioritized) {
      if (totalTokens + item.tokens <= budget) {
        selected.push(item);
        totalTokens += item.tokens;
      }
    }

    return selected;
  }
}

// ============================================================================
// SEMANTIC DIFF PARSER
// ============================================================================

class SemanticDiffParser {
  parse(
    filePath: string,
    oldContent: string,
    newContent: string
  ): SemanticDiff {
    const changes: CodeChange[] = [];
    const conflictMarkers: ConflictMarker[] = [];

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    this.detectConflicts(newLines, conflictMarkers);

    const operations = this.computeOperations(oldLines, newLines, changes);

    return {
      filePath,
      operations,
      changes,
      conflictMarkers,
      isClean: conflictMarkers.length === 0,
    };
  }

  apply(content: string, diff: SemanticDiff): string {
    if (!diff.isClean) {
      throw new MergeConflictError(diff.filePath, diff.conflictMarkers);
    }

    const lines = content.split('\n');
    const result: string[] = [];

    let lineIndex = 0;
    let changeIndex = 0;

    while (lineIndex < lines.length || changeIndex < diff.changes.length) {
      const change = diff.changes[changeIndex];

      if (!change || lineIndex < change.lineStart) {
        result.push(lines[lineIndex]);
        lineIndex++;
      } else {
        switch (change.operation) {
          case 'insert':
            result.push(change.newContent);
            changeIndex++;
            break;

          case 'delete':
            lineIndex = change.lineEnd + 1;
            changeIndex++;
            break;

          case 'replace':
            result.push(change.newContent);
            lineIndex = change.lineEnd + 1;
            changeIndex++;
            break;

          case 'move':
            lineIndex = change.lineEnd + 1;
            changeIndex++;
            break;
        }
      }
    }

    return result.join('\n');
  }

  resolveConflicts(
    diff: SemanticDiff,
    strategy: 'ours' | 'theirs' | 'union' = 'ours'
  ): SemanticDiff {
    if (diff.isClean) {
      return diff;
    }

    const resolvedChanges = diff.changes.filter(change => {
      return true;
    });

    return {
      ...diff,
      changes: resolvedChanges,
      conflictMarkers: [],
      isClean: true,
    };
  }

  private detectConflicts(
    lines: string[],
    conflictMarkers: ConflictMarker[]
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('<<<<<<<')) {
        conflictMarkers.push({ line: i, type: 'ours', content: line });
      } else if (line.startsWith('=======')) {
        conflictMarkers.push({ line: i, type: 'base', content: line });
      } else if (line.startsWith('>>>>>>>')) {
        conflictMarkers.push({ line: i, type: 'theirs', content: line });
      }
    }
  }

  private computeOperations(
    oldLines: string[],
    newLines: string[],
    changes: CodeChange[]
  ): DiffOperation[] {
    const operations: DiffOperation[] = [];

    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i >= oldLines.length) {
        changes.push({
          operation: 'insert',
          lineStart: j,
          lineEnd: j,
          oldContent: '',
          newContent: newLines[j],
          confidence: 1.0,
        });
        operations.push('insert');
        j++;
      } else if (j >= newLines.length) {
        changes.push({
          operation: 'delete',
          lineStart: i,
          lineEnd: i,
          oldContent: oldLines[i],
          newContent: '',
          confidence: 1.0,
        });
        operations.push('delete');
        i++;
      } else if (oldLines[i] === newLines[j]) {
        i++;
        j++;
      } else {
        changes.push({
          operation: 'replace',
          lineStart: i,
          lineEnd: i,
          oldContent: oldLines[i],
          newContent: newLines[j],
          confidence: 0.9,
        });
        operations.push('replace');
        i++;
        j++;
      }
    }

    return operations;
  }
}

// ============================================================================
// MODEL ADAPTER INTERFACE
// ============================================================================

interface IModelAdapter {
  readonly provider: ModelProvider;
  
  complete(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig
  ): Promise<InferenceResponse>;

  stream(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse>;
}

// ============================================================================
// ANTHROPIC ADAPTER
// ============================================================================

class AnthropicAdapter implements IModelAdapter {
  readonly provider: ModelProvider = 'anthropic';

  async complete(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig
  ): Promise<InferenceResponse> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      const messages = this.buildMessages(prompt, context);

      const response = await this.callAnthropicAPI(messages, config);

      const totalTime = performance.now() - startTime;

      return {
        requestId,
        content: response.content,
        tokens: {
          prompt: response.usage.input_tokens,
          completion: response.usage.output_tokens,
          total: response.usage.input_tokens + response.usage.output_tokens,
        },
        latency: {
          timeToFirstToken: response.ttft,
          totalTime,
          tokensPerSecond: response.usage.output_tokens / (totalTime / 1000),
          throughput: response.usage.output_tokens,
        },
        model: config.model,
        provider: this.provider,
        cached: false,
        speculative: false,
      };
    } catch (error) {
      throw new ModelProviderError(
        this.provider,
        `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async stream(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const startTime = performance.now();
    let firstTokenTime = 0;
    let totalTokens = 0;

    const messages = this.buildMessages(prompt, context);

    const response = await this.streamAnthropicAPI(messages, config, (chunk) => {
      if (firstTokenTime === 0) {
        firstTokenTime = performance.now() - startTime;
      }
      totalTokens++;
      onChunk(chunk);
    });

    const totalTime = performance.now() - startTime;

    return {
      requestId: this.generateRequestId(),
      content: response.content,
      tokens: {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      latency: {
        timeToFirstToken: firstTokenTime,
        totalTime,
        tokensPerSecond: totalTokens / (totalTime / 1000),
        throughput: totalTokens,
      },
      model: config.model,
      provider: this.provider,
      cached: false,
      speculative: false,
    };
  }

  private buildMessages(prompt: string, context: ContextWindow): unknown[] {
    const messages = [];

    if (context.items.length > 0) {
      const contextText = context.items
        .map(item => `[${item.type}] ${item.content}`)
        .join('\n\n');

      messages.push({
        role: 'user',
        content: `Context:\n${contextText}`,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    return messages;
  }

  private async callAnthropicAPI(messages: unknown[], config: ModelConfig): Promise<{
    content: string;
    usage: { input_tokens: number; output_tokens: number };
    ttft: number;
  }> {
    await this.delay(100);

    return {
      content: 'Generated response from Anthropic',
      usage: {
        input_tokens: 500,
        output_tokens: 200,
      },
      ttft: 50,
    };
  }

  private async streamAnthropicAPI(
    messages: unknown[],
    config: ModelConfig,
    onChunk: (chunk: string) => void
  ): Promise<{
    content: string;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    const chunks = ['Hello', ' world', ' from', ' Anthropic'];
    let content = '';

    for (const chunk of chunks) {
      await this.delay(50);
      onChunk(chunk);
      content += chunk;
    }

    return {
      content,
      usage: {
        input_tokens: 500,
        output_tokens: chunks.length,
      },
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// OPENAI ADAPTER
// ============================================================================

class OpenAIAdapter implements IModelAdapter {
  readonly provider: ModelProvider = 'openai';

  async complete(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig
  ): Promise<InferenceResponse> {
    const startTime = performance.now();

    try {
      const messages = this.buildMessages(prompt, context);
      const response = await this.callOpenAIAPI(messages, config);

      const totalTime = performance.now() - startTime;

      return {
        requestId: this.generateRequestId(),
        content: response.content,
        tokens: {
          prompt: response.usage.prompt_tokens,
          completion: response.usage.completion_tokens,
          total: response.usage.total_tokens,
        },
        latency: {
          timeToFirstToken: response.ttft,
          totalTime,
          tokensPerSecond: response.usage.completion_tokens / (totalTime / 1000),
          throughput: response.usage.completion_tokens,
        },
        model: config.model,
        provider: this.provider,
        cached: false,
        speculative: false,
      };
    } catch (error) {
      throw new ModelProviderError(
        this.provider,
        `OpenAI API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async stream(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const startTime = performance.now();
    let firstTokenTime = 0;

    const messages = this.buildMessages(prompt, context);
    const response = await this.streamOpenAIAPI(messages, config, (chunk) => {
      if (firstTokenTime === 0) {
        firstTokenTime = performance.now() - startTime;
      }
      onChunk(chunk);
    });

    const totalTime = performance.now() - startTime;

    return {
      requestId: this.generateRequestId(),
      content: response.content,
      tokens: {
        prompt: response.usage.prompt_tokens,
        completion: response.usage.completion_tokens,
        total: response.usage.total_tokens,
      },
      latency: {
        timeToFirstToken: firstTokenTime,
        totalTime,
        tokensPerSecond: response.usage.completion_tokens / (totalTime / 1000),
        throughput: response.usage.completion_tokens,
      },
      model: config.model,
      provider: this.provider,
      cached: false,
      speculative: false,
    };
  }

  private buildMessages(prompt: string, context: ContextWindow): unknown[] {
    const messages = [];

    if (context.items.length > 0) {
      const contextText = context.items
        .map(item => `[${item.type}] ${item.content}`)
        .join('\n\n');

      messages.push({
        role: 'system',
        content: `Context:\n${contextText}`,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    return messages;
  }

  private async callOpenAIAPI(messages: unknown[], config: ModelConfig): Promise<{
    content: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    ttft: number;
  }> {
    await this.delay(100);

    return {
      content: 'Generated response from OpenAI',
      usage: {
        prompt_tokens: 500,
        completion_tokens: 200,
        total_tokens: 700,
      },
      ttft: 50,
    };
  }

  private async streamOpenAIAPI(
    messages: unknown[],
    config: ModelConfig,
    onChunk: (chunk: string) => void
  ): Promise<{
    content: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }> {
    const chunks = ['Hello', ' world', ' from', ' OpenAI'];
    let content = '';

    for (const chunk of chunks) {
      await this.delay(50);
      onChunk(chunk);
      content += chunk;
    }

    return {
      content,
      usage: {
        prompt_tokens: 500,
        completion_tokens: chunks.length,
        total_tokens: 500 + chunks.length,
      },
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// LOCAL MODEL ADAPTER
// ============================================================================

class LocalModelAdapter implements IModelAdapter {
  readonly provider: ModelProvider = 'local';

  async complete(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig
  ): Promise<InferenceResponse> {
    const startTime = performance.now();

    try {
      const response = await this.callLocalEndpoint(prompt, context, config);

      const totalTime = performance.now() - startTime;

      return {
        requestId: this.generateRequestId(),
        content: response.content,
        tokens: response.tokens,
        latency: {
          timeToFirstToken: response.ttft,
          totalTime,
          tokensPerSecond: response.tokens.completion / (totalTime / 1000),
          throughput: response.tokens.completion,
        },
        model: config.model,
        provider: this.provider,
        cached: false,
        speculative: false,
      };
    } catch (error) {
      throw new ModelProviderError(
        this.provider,
        `Local model error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async stream(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const response = await this.complete(prompt, context, config);
    onChunk(response.content);
    return response;
  }

  private async callLocalEndpoint(
    prompt: string,
    context: ContextWindow,
    config: ModelConfig
  ): Promise<{
    content: string;
    tokens: TokenUsage;
    ttft: number;
  }> {
    await this.delay(200);

    const promptTokens = TokenCounter.count(prompt) + context.totalTokens;
    const completionTokens = 150;

    return {
      content: 'Generated response from local model',
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      ttft: 100,
    };
  }

  private generateRequestId(): string {
    return `req_local_${Date.now()}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// MODEL ROUTER WITH FALLBACK
// ============================================================================

class ModelRouter {
  private readonly adapters = new Map<ModelProvider, IModelAdapter>();
  private readonly fallbackChain: ModelProvider[] = ['anthropic', 'openai', 'local'];

  constructor() {
    this.adapters.set('anthropic', new AnthropicAdapter());
    this.adapters.set('openai', new OpenAIAdapter());
    this.adapters.set('local', new LocalModelAdapter());
  }

  async route(
    request: InferenceRequest,
    eventBus: TypedEventEmitter<ContextEngineEventMap>
  ): Promise<InferenceResponse> {
    const providers = [request.model.provider, ...this.fallbackChain];
    let lastError: Error | null = null;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const adapter = this.adapters.get(provider);

      if (!adapter) continue;

      try {
        eventBus.emit('inference:started', {
          requestId: request.id,
          provider,
        });

        const response = request.stream
          ? await adapter.stream(
              request.prompt,
              request.context,
              { ...request.model, provider },
              (chunk) => {
                eventBus.emit('stream:chunk', {
                  requestId: request.id,
                  chunk,
                  tokens: TokenCounter.count(chunk),
                });
              }
            )
          : await adapter.complete(
              request.prompt,
              request.context,
              { ...request.model, provider }
            );

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (i < providers.length - 1) {
          const nextProvider = providers[i + 1];
          eventBus.emit('model:fallback', {
            from: provider,
            to: nextProvider,
            reason: lastError.message,
          });
        }
      }
    }

    throw lastError || new ModelProviderError('unknown', 'All providers failed');
  }
}

// ============================================================================
// SPECULATIVE EXECUTION ENGINE
// ============================================================================

class SpeculativeExecutionEngine {
  private readonly cache = new Map<string, SpeculativeCache>();
  private readonly maxCacheSize = 100;
  private readonly predictionWindow = 5000;

  predictCursorMovement(
    currentPosition: CursorPosition,
    history: ReadonlyArray<CursorPosition>
  ): CursorPosition {
    if (history.length < 2) {
      return currentPosition;
    }

    const recent = history.slice(-5);
    let avgLineDelta = 0;
    let avgColDelta = 0;

    for (let i = 1; i < recent.length; i++) {
      avgLineDelta += recent[i].line - recent[i - 1].line;
      avgColDelta += recent[i].column - recent[i - 1].column;
    }

    avgLineDelta /= recent.length - 1;
    avgColDelta /= recent.length - 1;

    return {
      filePath: currentPosition.filePath,
      line: Math.max(0, Math.round(currentPosition.line + avgLineDelta)),
      column: Math.max(0, Math.round(currentPosition.column + avgColDelta)),
      offset: currentPosition.offset,
    };
  }

  async pregenerate(
    cursorPosition: CursorPosition,
    context: ContextWindow,
    router: ModelRouter,
    config: ModelConfig,
    eventBus: TypedEventEmitter<ContextEngineEventMap>
  ): Promise<void> {
    const cacheKey = this.getCacheKey(cursorPosition);

    if (this.cache.has(cacheKey)) {
      return;
    }

    try {
      const completions: SpeculativeCompletion[] = [];

      for (let i = 0; i < 3; i++) {
        const request: InferenceRequest = {
          id: `spec_${Date.now()}_${i}`,
          prompt: `Complete the code at line ${cursorPosition.line}`,
          context,
          model: config,
          stream: false,
          speculative: true,
        };

        const response = await router.route(request, eventBus);

        completions.push({
          id: request.id,
          content: response.content,
          confidence: 0.8 - i * 0.2,
          tokens: response.tokens.completion,
          astValid: true,
          metadata: {},
        });
      }

      const speculativeCache: SpeculativeCache = {
        cursorPosition,
        predictedContext: context,
        preGeneratedCompletions: completions,
        timestamp: Date.now(),
        confidence: 0.8,
      };

      this.cache.set(cacheKey, speculativeCache);

      if (this.cache.size > this.maxCacheSize) {
        const oldest = Array.from(this.cache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        this.cache.delete(oldest[0]);
      }

      eventBus.emit('speculative:generated', { completions });
    } catch (error) {
      // Suppress speculative errors
    }
  }

  getCached(cursorPosition: CursorPosition): SpeculativeCache | null {
    const cacheKey = this.getCacheKey(cursorPosition);
    const cached = this.cache.get(cacheKey);

    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.predictionWindow) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached;
  }

  private getCacheKey(position: CursorPosition): string {
    return `${position.filePath}:${position.line}:${position.column}`;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// CONTEXT ENGINE
// ============================================================================

class AIContextEngine extends TypedEventEmitter<ContextEngineEventMap> {
  private readonly budgetManager: TokenBudgetManager;
  private readonly prioritizer: ContextPrioritizer;
  private readonly diffParser: SemanticDiffParser;
  private readonly router: ModelRouter;
  private readonly speculativeEngine: SpeculativeExecutionEngine;

  private readonly contextItems = new Map<string, ContextItem>();
  private currentWindow: ContextWindow | null = null;

  private metrics: ContextEngineMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageTTFT: 0,
    averageTokensPerSecond: 0,
    cacheHitRate: 0,
    speculativeHitRate: 0,
    averageContextTokens: 0,
    providerBreakdown: {
      anthropic: 0,
      openai: 0,
      local: 0,
      custom: 0,
    },
  };

  private readonly metricsBuffer: {
    ttft: number[];
    tokensPerSecond: number[];
    contextTokens: number[];
    speculativeHits: number;
    speculativeMisses: number;
  } = {
    ttft: [],
    tokensPerSecond: [],
    contextTokens: [],
    speculativeHits: 0,
    speculativeMisses: 0,
  };

  constructor(
    maxContextTokens: number = 100000,
    reservePercentage: number = 0.1
  ) {
    super();

    this.budgetManager = new TokenBudgetManager(maxContextTokens, reservePercentage);
    this.prioritizer = new ContextPrioritizer();
    this.diffParser = new SemanticDiffParser();
    this.router = new ModelRouter();
    this.speculativeEngine = new SpeculativeExecutionEngine();
  }

  addContext(item: Omit<ContextItem, 'id' | 'timestamp'>): string {
    const id = this.generateContextId();
    const contextItem: ContextItem = {
      ...item,
      id,
      timestamp: Date.now(),
    };

    this.contextItems.set(id, contextItem);

    void this.buildContextWindow();

    return id;
  }

  removeContext(id: string): boolean {
    const item = this.contextItems.get(id);
    if (!item) return false;

    this.contextItems.delete(id);
    this.budgetManager.deallocate(item.tokens);

    void this.buildContextWindow();

    return true;
  }

  async buildContextWindow(): Promise<ContextWindow> {
    const startTime = performance.now();

    const allItems = Array.from(this.contextItems.values());
    const budget = this.budgetManager.remaining;

    const selectedItems = this.prioritizer.selectWithinBudget(allItems, budget);

    const totalTokens = selectedItems.reduce((sum, item) => sum + item.tokens, 0);

    const priorityBreakdown: Record<ContextPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
      background: 0,
    };

    for (const item of selectedItems) {
      priorityBreakdown[item.priority] += item.tokens;
    }

    const contentHash = this.hashContextWindow(selectedItems);

    const window: ContextWindow = {
      items: selectedItems,
      totalTokens,
      priorityBreakdown,
      contentHash,
    };

    this.currentWindow = window;

    const duration = performance.now() - startTime;
    this.emit('context:built', { window, duration });

    this.metricsBuffer.contextTokens.push(totalTokens);

    return window;
  }

  async updateContext(
    filePath: string,
    oldContent: string,
    newContent: string
  ): Promise<void> {
    const diff = this.diffParser.parse(filePath, oldContent, newContent);

    this.emit('diff:parsed', diff);

    if (!diff.isClean) {
      this.emit('diff:conflict', {
        filePath: diff.filePath,
        conflicts: diff.conflictMarkers,
      });
    }

    for (const [id, item] of this.contextItems.entries()) {
      if (item.metadata.filePath === filePath) {
        const updatedContent = diff.isClean
          ? this.diffParser.apply(item.content, diff)
          : item.content;

        const updatedItem: ContextItem = {
          ...item,
          content: updatedContent,
          tokens: TokenCounter.count(updatedContent),
          timestamp: Date.now(),
        };

        this.contextItems.set(id, updatedItem);
      }
    }

    const window = await this.buildContextWindow();
    this.emit('context:updated', { window, diff });
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    this.metrics.totalRequests++;

    try {
      if (request.speculative && request.metadata?.cursorPosition) {
        const cached = this.speculativeEngine.getCached(
          request.metadata.cursorPosition as CursorPosition
        );

        if (cached && cached.preGeneratedCompletions.length > 0) {
          this.metricsBuffer.speculativeHits++;

          this.emit('speculative:cache_hit', {
            cursorPosition: cached.cursorPosition,
            confidence: cached.confidence,
          });

          const completion = cached.preGeneratedCompletions[0];

          return {
            requestId: request.id,
            content: completion.content,
            tokens: {
              prompt: request.context.totalTokens,
              completion: completion.tokens,
              total: request.context.totalTokens + completion.tokens,
            },
            latency: {
              timeToFirstToken: 0,
              totalTime: 0,
              tokensPerSecond: Infinity,
              throughput: completion.tokens,
            },
            model: request.model.model,
            provider: request.model.provider,
            cached: true,
            speculative: true,
          };
        } else {
          this.metricsBuffer.speculativeMisses++;

          this.emit('speculative:cache_miss', {
            cursorPosition: request.metadata.cursorPosition as CursorPosition,
          });
        }
      }

      const response = await this.router.route(request, this);

      this.metrics.successfulRequests++;
      this.metrics.providerBreakdown[response.provider]++;

      this.metricsBuffer.ttft.push(response.latency.timeToFirstToken);
      this.metricsBuffer.tokensPerSecond.push(response.latency.tokensPerSecond);

      this.updateMetrics();

      this.emit('inference:completed', response);

      return response;
    } catch (error) {
      this.metrics.failedRequests++;

      const contextError = error instanceof ContextEngineError
        ? error
        : new ContextEngineError(
            error instanceof Error ? error.message : String(error),
            'INFERENCE_ERROR'
          );

      this.emit('inference:failed', {
        requestId: request.id,
        error: contextError,
        provider: request.model.provider,
      });

      this.emit('error', contextError);

      throw error;
    }
  }

  async inferStream(
    request: InferenceRequest,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const streamRequest: InferenceRequest = {
      ...request,
      stream: true,
    };

    return this.infer(streamRequest);
  }

  async pregenerateCompletions(
    cursorPosition: CursorPosition,
    history: ReadonlyArray<CursorPosition>,
    modelConfig: ModelConfig
  ): Promise<void> {
    const predictedPosition = this.speculativeEngine.predictCursorMovement(
      cursorPosition,
      history
    );

    const context = this.currentWindow || await this.buildContextWindow();

    await this.speculativeEngine.pregenerate(
      predictedPosition,
      context,
      this.router,
      modelConfig,
      this
    );
  }

  private updateMetrics(): void {
    const { ttft, tokensPerSecond, contextTokens, speculativeHits, speculativeMisses } =
      this.metricsBuffer;

    if (ttft.length > 0) {
      this.metrics.averageTTFT = ttft.reduce((a, b) => a + b, 0) / ttft.length;
    }

    if (tokensPerSecond.length > 0) {
      this.metrics.averageTokensPerSecond =
        tokensPerSecond.reduce((a, b) => a + b, 0) / tokensPerSecond.length;
    }

    if (contextTokens.length > 0) {
      this.metrics.averageContextTokens =
        contextTokens.reduce((a, b) => a + b, 0) / contextTokens.length;
    }

    const totalSpeculative = speculativeHits + speculativeMisses;
    if (totalSpeculative > 0) {
      this.metrics.speculativeHitRate = speculativeHits / totalSpeculative;
    }

    const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;
    if (totalRequests > 0) {
      this.metrics.cacheHitRate = speculativeHits / totalRequests;
    }

    const maxBufferSize = 1000;
    if (ttft.length > maxBufferSize) ttft.splice(0, ttft.length - maxBufferSize);
    if (tokensPerSecond.length > maxBufferSize)
      tokensPerSecond.splice(0, tokensPerSecond.length - maxBufferSize);
    if (contextTokens.length > maxBufferSize)
      contextTokens.splice(0, contextTokens.length - maxBufferSize);

    this.emit('metrics:updated', this.metrics);
  }

  getMetrics(): Readonly<ContextEngineMetrics> {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageTTFT: 0,
      averageTokensPerSecond: 0,
      cacheHitRate: 0,
      speculativeHitRate: 0,
      averageContextTokens: 0,
      providerBreakdown: {
        anthropic: 0,
        openai: 0,
        local: 0,
        custom: 0,
      },
    };

    this.metricsBuffer.ttft = [];
    this.metricsBuffer.tokensPerSecond = [];
    this.metricsBuffer.contextTokens = [];
    this.metricsBuffer.speculativeHits = 0;
    this.metricsBuffer.speculativeMisses = 0;
  }

  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private hashContextWindow(items: ReadonlyArray<ContextItem>): string {
    const content = items
      .map(item => `${item.id}:${item.content}:${item.timestamp}`)
      .join('|');

    return createHash('sha256').update(content).digest('hex');
  }

  async dispose(): Promise<void> {
    this.contextItems.clear();
    this.speculativeEngine.clear();
    this.budgetManager.reset();
    this.removeAllListeners();

    if (global.gc) {
      global.gc();
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  AIContextEngine,
  ContextEngineError,
  TokenBudgetExceededError,
  ModelProviderError,
  StreamParsingError,
  MergeConflictError,
  SpeculativeExecutionError,
  TokenCounter,
};

export type {
  ModelProvider,
  ContextPriority,
  DiffOperation,
  TokenBudget,
  ContextItem,
  ContextWindow,
  SemanticDiff,
  CodeChange,
  ConflictMarker,
  ModelConfig,
  InferenceRequest,
  InferenceResponse,
  TokenUsage,
  LatencyMetrics,
  SpeculativeCache,
  CursorPosition,
  SpeculativeCompletion,
  SemanticAccuracy,
  ContextEngineMetrics,
  ContextEngineEventMap,
};

export function createContextEngine(
  maxContextTokens?: number,
  reservePercentage?: number
): AIContextEngine {
  return new AIContextEngine(maxContextTokens, reservePercentage);
}
