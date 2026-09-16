import { BackendKernel } from "../core/BackendKernel.js";
import { RuntimeManager } from "./RuntimeManager.js";
import { ServiceRegistry } from "../services/ServiceRegistry.js";
import { MemoryRepository } from "../memory/MemoryRepository.js";
import { IntentRouter } from "../intelligence/IntentRouter.js";

export class BackendApplicationRuntime {

  private kernel: BackendKernel;
  private runtime: RuntimeManager;
  private services: ServiceRegistry;
  private memory: MemoryRepository;
  private intent: IntentRouter;


  constructor(){

    this.kernel = new BackendKernel();
    this.runtime = new RuntimeManager();
    this.services = new ServiceRegistry();
    this.memory = new MemoryRepository();
    this.intent = new IntentRouter();

  }


  start(){

    this.kernel.initialize();

    this.runtime.initialize();

    return {
      status:"ONLINE",
      components:{
        kernel:true,
        runtime:true,
        services:true,
        memory:true,
        intelligence:true
      },
      timestamp:Date.now()
    };

  }


  process(request:string){

    const intent =
      this.intent.route(request);


    return {
      request,
      intent,
      runtime:"EXECUTED"
    };

  }

}
