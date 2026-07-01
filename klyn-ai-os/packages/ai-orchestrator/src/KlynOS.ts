import { KlynAIKernel } from "./KlynAIKernel";
import { AIModelRouter } from "../../ai-gateway/src/AIModelRouter";
import { AgentRuntime } from "../../agent-runtime/src/runtime/AgentRuntime";

/**
 * KLYN AI OS - SYSTEM BOOTSTRAP
 */

export class KlynOS {

  private kernel: KlynAIKernel;

  constructor() {
    const router = new AIModelRouter();
    const runtime = new AgentRuntime();

    this.kernel = new KlynAIKernel(router, runtime);
  }

  async run(task: string, workspaceId: string) {
    return this.kernel.execute(task, workspaceId);
  }
}
