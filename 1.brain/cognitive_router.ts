/**
 * KLYN AI OS - Cognitive Router
 * Autonomous decision engine for optimal model allocation
 */

import type { LLMRequest, LLMResponse, TaskType, ModelName } from './types.ts';
import { LLMGateway } from './llm_gateway.ts';
import { MODEL_REGISTRY } from './config.ts';

interface RoutingDecision {
  selectedModel: ModelName;
  reasoning: string;
  confidence: number;
  estimatedCost: number;
  fallbackChain: ModelName[];
}

export class CognitiveRouter {
  private gateway: LLMGateway;
  private routingHistory: Map<string, RoutingDecision> = new Map();

  constructor(gateway?: LLMGateway) {
    this.gateway = gateway || new LLMGateway();
  }

  /**
   * Autonomous routing with intelligent model selection
   */
  async route(request: LLMRequest): Promise<LLMResponse> {
    const decision = this.makeRoutingDecision(request);
    
    console.log(`[CognitiveRouter] Decision: ${decision.selectedModel}`);
    console.log(`[CognitiveRouter] Reasoning: ${decision.reasoning}`);
    console.log(`[CognitiveRouter] Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
    console.log(`[CognitiveRouter] Est. Cost: $${decision.estimatedCost.toFixed(4)}`);

    // Store decision for learning
    const requestHash = this.hashRequest(request);
    this.routingHistory.set(requestHash, decision);

    // Execute via gateway with decision parameters
    const enhancedRequest: LLMRequest = {
      ...request,
      preferredModel: decision.selectedModel,
      fallbackChain: decision.fallbackChain,
    };

    return await this.gateway.generate(enhancedRequest);
  }

  /**
   * Core routing decision engine
   */
  private makeRoutingDecision(request: LLMRequest): RoutingDecision {
    const taskType = request.taskType || this.inferTaskType(request.prompt);
    const promptLength = request.prompt.length;
    const hasImages = (request.images?.length || 0) > 0;
    const needsTools = (request.tools?.length || 0) > 0;

    // Rule-based expert system
    let selectedModel: ModelName;
    let reasoning: string;
    let confidence: number;

    // RULE 1: Massive context (>100k chars) → Gemini
    if (promptLength > 100_000) {
      selectedModel = 'gemini-3.5-pro';
      reasoning = 'Ultra-large context requires Gemini 2M window';
      confidence = 0.95;
    }
    // RULE 2: Agentic coding + self-healing → Claude Fable 5
    else if (taskType === 'agentic_coding' || taskType === 'self_healing') {
      selectedModel = 'claude-fable-5';
      reasoning = 'Autonomous coding requires Claude Fable 5 agentic capabilities';
      confidence = 0.90;
    }
    // RULE 3: Complex refactoring → Claude Fable 5
    else if (taskType === 'refactoring' && promptLength > 5000) {
      selectedModel = 'claude-fable-5';
      reasoning = 'Complex refactoring benefits from Claude reasoning';
      confidence = 0.85;
    }
    // RULE 4: Architecture + multimodal → GPT-5.6 Sol
    else if (taskType === 'architecture' || (taskType === 'code_inspection' && hasImages)) {
      selectedModel = 'gpt-5.6-sol';
      reasoning = 'System design and multimodal analysis optimized for GPT-5.6';
      confidence = 0.88;
    }
    // RULE 5: Dependency mapping with large context → Gemini
    else if (taskType === 'dependency_mapping' && promptLength > 20_000) {
      selectedModel = 'gemini-3.5-pro';
      reasoning = 'Cross-repo analysis requires extended context';
      confidence = 0.82;
    }
    // RULE 6: High-volume lightweight tasks → DeepSeek
    else if (
      taskType === 'test_generation' ||
      taskType === 'log_analysis' ||
      (taskType === 'code_inspection' && promptLength < 3000)
    ) {
      selectedModel = 'deepseek-v4-pro';
      reasoning = 'Cost-optimized execution for high-volume lightweight task';
      confidence = 0.92;
    }
    // RULE 7: General small tasks → DeepSeek (cost optimization)
    else if (promptLength < 2000 && !needsTools) {
      selectedModel = 'deepseek-v4-pro';
      reasoning = 'Simple task routed to cost-efficient model';
      confidence = 0.80;
    }
    // RULE 8: Default to Claude for general complex tasks
    else {
      selectedModel = 'claude-fable-5';
      reasoning = 'Default to primary agentic model for general complex tasks';
      confidence = 0.75;
    }

    // Build intelligent fallback chain
    const fallbackChain = this.buildFallbackChain(selectedModel, taskType);

    // Estimate cost
    const estimatedCost = this.estimateCost(request.prompt, selectedModel);

    return {
      selectedModel,
      reasoning,
      confidence,
      estimatedCost,
      fallbackChain,
    };
  }

  /**
   * Infer task type from prompt content
   */
  private inferTaskType(prompt: string): TaskType {
    const lower = prompt.toLowerCase();

    if (lower.includes('refactor') || lower.includes('redesign')) {
      return 'refactoring';
    }
    if (lower.includes('architecture') || lower.includes('design pattern')) {
      return 'architecture';
    }
    if (lower.includes('test') || lower.includes('unit test')) {
      return 'test_generation';
    }
    if (lower.includes('error') || lower.includes('log') || lower.includes('debug')) {
      return 'log_analysis';
    }
    if (lower.includes('dependency') || lower.includes('import')) {
      return 'dependency_mapping';
    }
    if (lower.includes('fix') || lower.includes('bug') || lower.includes('heal')) {
      return 'self_healing';
    }
    if (lower.includes('review') || lower.includes('inspect')) {
      return 'code_inspection';
    }
    if (lower.includes('implement') || lower.includes('create') || lower.includes('generate code')) {
      return 'agentic_coding';
    }

    return 'general';
  }

  /**
   * Build optimal fallback chain based on task
   */
  private buildFallbackChain(primary: ModelName, taskType: TaskType): ModelName[] {
    const taskFallbacks: Record<TaskType, ModelName[]> = {
      agentic_coding: ['claude-fable-5', 'gpt-5.6-sol', 'deepseek-v4-pro'],
      refactoring: ['claude-fable-5', 'gpt-5.6-sol', 'deepseek-v4-pro'],
      architecture: ['gpt-5.6-sol', 'claude-fable-5', 'gemini-3.5-pro'],
      code_inspection: ['gpt-5.6-sol', 'deepseek-v4-pro', 'claude-fable-5'],
      test_generation: ['deepseek-v4-pro', 'gpt-5.6-sol', 'claude-fable-5'],
      log_analysis: ['deepseek-v4-pro', 'gpt-5.6-sol', 'claude-fable-5'],
      dependency_mapping: ['gemini-3.5-pro', 'gpt-5.6-sol', 'claude-fable-5'],
      self_healing: ['claude-fable-5', 'gpt-5.6-sol', 'deepseek-v4-pro'],
      general: ['claude-fable-5', 'deepseek-v4-pro', 'gpt-5.6-sol'],
    };

    const chain = taskFallbacks[taskType] || taskFallbacks.general;
    return chain.filter(m => m !== primary).slice(0, 2);
  }

  /**
   * Estimate request cost
   */
  private estimateCost(prompt: string, model: ModelName, outputTokens = 1000): number {
    const modelConfig = MODEL_REGISTRY[model];
    const inputTokens = Math.ceil(prompt.length / 4);
    
    const inputCost = (inputTokens / 1_000_000) * modelConfig.costPerMToken;
    const outputCost = (outputTokens / 1_000_000) * modelConfig.costPerMTokenOutput;
    
    return inputCost + outputCost;
  }

  /**
   * Hash request for caching/history
   */
  private hashRequest(request: LLMRequest): string {
    const content = request.prompt + (request.taskType || '');
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Get routing analytics
   */
  getRoutingStats() {
    const decisions = Array.from(this.routingHistory.values());
    const modelCounts: Record<string, number> = {};
    
    decisions.forEach(d => {
      modelCounts[d.selectedModel] = (modelCounts[d.selectedModel] || 0) + 1;
    });

    return {
      totalDecisions: decisions.length,
      averageConfidence: decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length || 0,
      modelDistribution: modelCounts,
    };
  }

  /**
   * Access to underlying gateway
   */
  getGateway(): LLMGateway {
    return this.gateway;
  }
}
