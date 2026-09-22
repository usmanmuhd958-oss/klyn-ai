import { BackendKernel } from "../core/BackendKernel.js";
import { RuntimeManager } from "./RuntimeManager.js";
import { ExecutionPipeline } from "./ExecutionPipeline.js";
import { ServiceRegistry } from "../services/ServiceRegistry.js";
import { MemoryService } from "../memory/MemoryService.js";
import { IntentRouter } from "../intelligence/IntentRouter.js";

export class BackendCompositionRoot {

  readonly kernel: BackendKernel;
  readonly runtime: RuntimeManager;
  readonly pipeline: ExecutionPipeline;
  readonly services: ServiceRegistry;
  readonly memory: MemoryService;
  readonly intent: IntentRouter;


  constructor(){

    this.kernel = new BackendKernel();

    this.runtime = new RuntimeManager();

    this.pipeline = new ExecutionPipeline();

    this.services = new ServiceRegistry();

    this.memory = new MemoryService();

    this.intent = new IntentRouter();

  }


  bootstrap(){

    return {
      status: "ONLINE",
      components:[
        "BackendKernel",
        "RuntimeManager",
        "ExecutionPipeline",
        "ServiceRegistry",
        "MemoryService",
        "IntentRouter"
      ]
    };

  }

}
