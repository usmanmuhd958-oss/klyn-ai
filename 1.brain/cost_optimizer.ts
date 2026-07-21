/**
 * KLYN AI OS - Cost Optimizer
 * Real-time cost tracking and intelligent model selection
 */

import type { CostMetrics, TaskType, ModelName } from './types.ts';
import { MODEL_REGISTRY } from './config.ts';

export class CostOptimizer {
  private metrics: CostMetrics = {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    costByModel: {} as Record<ModelName, number>,
    costByTask: {} as Record<TaskType, number>,
    averageLatency: 0,
  };

  private latencies: number[] = [];

  recordUsage(
    model: ModelName,
    taskType: TaskType,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    latencyMs: number
  ): void {
    this.metrics.totalRequests++;
    this.metrics.totalInputTokens += inputTokens;
    this.metrics.totalOutputTokens += outputTokens;
    this.metrics.totalCost += cost;

    this.metrics.costByModel[model] = (this.metrics.costByModel[model] || 0) + cost;
    this.metrics.costByTask[taskType] = (this.metrics.costByTask[taskType] || 0) + cost;

    this.latencies.push(latencyMs);
    this.metrics.averageLatency = 
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  getMetrics(): CostMetrics {
    return { ...this.metrics };
  }

  /**
   * Estimate cost for a given prompt
   */
  estimateCost(prompt: string, model: ModelName, outputTokens = 1000): number {
    const modelConfig = MODEL_REGISTRY[model];
    const inputTokens = this.estimateTokens(prompt);
    
    const inputCost = (inputTokens / 1_000_000) * modelConfig.costPerMToken;
    const outputCost = (outputTokens / 1_000_000) * modelConfig.costPerMTokenOutput;
    
    return inputCost + outputCost;
  }

  /**
   * Recommend most cost-effective model for task
   */
  recommendModel(taskType: TaskType, prompt: string): ModelName {
    const suitableModels = Object.values(MODEL_REGISTRY)
      .filter(m => m.strengths.includes(taskType))
      .sort((a, b) => a.costPerMToken - b.costPerMToken);

    if (suitableModels.length === 0) {
      return 'deepseek-v4-pro'; // Default fallback
    }

    const inputTokens = this.estimateTokens(prompt);
    
    // Use DeepSeek for simple tasks
    if (inputTokens < 2000 && taskType !== 'agentic_coding') {
      return 'deepseek-v4-pro';
    }

    // Use Gemini for massive context
    if (inputTokens > 100_000) {
      return 'gemini-3.5-pro';
    }

    return suitableModels[0].modelName;
  }

  /**
   * Simple token estimation (4 chars ≈ 1 token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate cost report
   */
  generateReport(): string {
    const m = this.metrics;
    return `
╔══════════════════════════════════════════════════╗
║        KLYN AI OS - Cost Analytics Report        ║
╚══════════════════════════════════════════════════╝

Total Requests:      ${m.totalRequests}
Total Input Tokens:  ${m.totalInputTokens.toLocaleString()}
Total Output Tokens: ${m.totalOutputTokens.toLocaleString()}
Total Cost:          $${m.totalCost.toFixed(4)}
Average Latency:     ${m.averageLatency.toFixed(0)}ms

Cost by Model:
${Object.entries(m.costByModel)
  .map(([model, cost]) => `  ${model.padEnd(20)} $${cost.toFixed(4)}`)
  .join('\n')}

Cost by Task:
${Object.entries(m.costByTask)
  .map(([task, cost]) => `  ${task.padEnd(20)} $${cost.toFixed(4)}`)
  .join('\n')}
    `.trim();
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      costByModel: {} as Record<ModelName, number>,
      costByTask: {} as Record<TaskType, number>,
      averageLatency: 0,
    };
    this.latencies = [];
  }
}
