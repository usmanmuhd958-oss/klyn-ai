/**
 * KLYN AI OS - Execution Pipeline Layer
 * Controls scheduling, concurrency, and task execution flow
 */

import { AgentRuntime } from "../../agent-runtime/src/runtime/AgentRuntime";
import { AIModelRouter } from "../../ai-gateway/src/AIModelRouter";

export interface PipelineTask {
  id: string;
  type: "agent" | "workflow" | "ai-call";
  payload: any;
  priority?: number;
}

export class ExecutionPipeline {

  private queue: PipelineTask[] = [];
  private running = false;

  constructor(
    private runtime: AgentRuntime,
    private router: AIModelRouter
  ) {}

  /**
   * Add task to execution queue
   */
  addTask(task: PipelineTask) {
    this.queue.push(task);
    this.sortQueue();
  }

  /**
   * Start pipeline execution loop
   */
  async start() {
    if (this.running) return;

    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      await this.executeTask(task);
    }

    this.running = false;
  }

  /**
   * Core execution dispatcher
   */
  private async executeTask(task: PipelineTask) {

    try {
      switch (task.type) {

        case "ai-call":
          return await this.handleAICall(task);

        case "agent":
          return await this.handleAgent(task);

        case "workflow":
          return await this.handleWorkflow(task);
      }

    } catch (err) {
      console.error("Pipeline error:", err);

      // simple retry strategy
      if (task.priority !== -1) {
        this.queue.push(task);
      }
    }
  }

  /**
   * AI MODEL CALL EXECUTION
   */
  private async handleAICall(task: PipelineTask) {
    return await this.router.route(task.payload);
  }

  /**
   * AGENT EXECUTION
   */
  private async handleAgent(task: PipelineTask) {
    return await this.runtime.run(task.payload);
  }

  /**
   * WORKFLOW EXECUTION (placeholder for DAG engine)
   */
  private async handleWorkflow(task: PipelineTask) {
    return {
      status: "workflow_executed",
      data: task.payload,
    };
  }

  /**
   * PRIORITY SORTING (OS-level scheduling)
   */
  private sortQueue() {
    this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
}
