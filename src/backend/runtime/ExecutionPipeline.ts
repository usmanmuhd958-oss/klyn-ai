import { BackendKernel } from "../core/BackendKernel.js";
import { RuntimeKernel } from "./RuntimeKernel.js";
import { IntentRouter } from "../intelligence/IntentRouter.js";
import { MemoryService } from "../memory/MemoryService.js";

export class ExecutionPipeline {

  private backendKernel: BackendKernel;
  private runtimeKernel: RuntimeKernel;
  private intentRouter: IntentRouter;
  private memory: MemoryService;

  constructor() {
    this.backendKernel = new BackendKernel();
    this.runtimeKernel = new RuntimeKernel();
    this.intentRouter = new IntentRouter();
    this.memory = new MemoryService();
  }


  async execute(input: string) {

    const intent = this.intentRouter.route(input);

    this.memory.store({
      id: crypto.randomUUID(),
      type: "episodic",
      content: input,
      createdAt: Date.now()
    });


    const task = {
      id: crypto.randomUUID(),
      type: intent.type,
      payload: input
    };


    this.runtimeKernel.registerTask(task);

    return {
      success: true,
      intent,
      taskId: task.id
    };

  }

}
