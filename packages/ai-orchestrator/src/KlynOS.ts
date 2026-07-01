import { AIModelRouter } from "../../ai-gateway/src/AIModelRouter";
import { AgentRuntime } from "../../agent-runtime/src/runtime/AgentRuntime";
import { ExecutionPipeline } from "./ExecutionPipeline";

export class KlynOS {

  private router: AIModelRouter;
  private runtime: AgentRuntime;
  private pipeline: ExecutionPipeline;

  constructor() {
    this.router = new AIModelRouter();
    this.runtime = new AgentRuntime();
    this.pipeline = new ExecutionPipeline(this.runtime, this.router);
  }

  async run(task: string, workspaceId: string) {

    const aiResult = await this.router.route({
      task,
      type: "reasoning"
    });

    this.pipeline.addTask({
      id: `task-${Date.now()}`,
      type: "agent",
      payload: {
        input: aiResult,
        workspaceId
      },
      priority: 10
    });

    await this.pipeline.start();

    return {
      status: "completed",
      task,
      aiResult
    };
  }
}
