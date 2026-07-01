/**
 * KLYN AI OS - Unified Kernel
 * This is the central brain of the entire system
 */

import { AIModelRouter } from "../../ai-gateway/src/AIModelRouter";
import { AgentRuntime } from "../../agent-runtime/src/runtime/AgentRuntime";

export class KlynAIKernel {

  private router: AIModelRouter;
  private runtime: AgentRuntime;

  constructor(router: AIModelRouter, runtime: AgentRuntime) {
    this.router = router;
    this.runtime = runtime;
  }

  /**
   * SINGLE ENTRY POINT FOR ENTIRE AI OS
   */
  async execute(task: string, workspaceId: string) {

    // 1. ANALYZE INTENT
    const intent = await this.router.route({
      task,
      type: "reasoning",
      complexity: "high",
    });

    // 2. CREATE AGENT CONTEXT
    const context = {
      agentId: "kernel-agent",
      role: "planner",
      taskId: `task-${Date.now()}`,
      workspaceId,
      input: intent.output,
    };

    // 3. EXECUTE THROUGH AGENT RUNTIME
    const result = await this.runtime.run(context);

    return {
      task,
      intent,
      result,
      status: "completed",
      timestamp: new Date().toISOString(),
    };
  }
}
