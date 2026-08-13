#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN BACKEND FOUNDATION V4"
echo " EXECUTION PIPELINE WIRING"
echo "======================================"

mkdir -p src/backend/runtime

cat > src/backend/runtime/ExecutionPipeline.ts <<'TS'
import { BackendKernel } from "../core/BackendKernel";
import { RuntimeKernel } from "./RuntimeKernel";
import { IntentRouter } from "../intelligence/IntentRouter";
import { MemoryService } from "../memory/MemoryService";

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
TS


echo ""
echo "✓ ExecutionPipeline.ts created"

echo ""
echo "======================================"
echo " BACKEND FOUNDATION V4 READY"
echo " EXECUTION PIPELINE ONLINE"
echo "======================================"
