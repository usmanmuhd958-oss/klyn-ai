import {ModuleOrchestrator} from "./ModuleOrchestrator.js";


export class RuntimeBootstrap {


  constructor(
    private orchestrator = new ModuleOrchestrator()
  ){}


  start(){

    return {
      status:"running",
      modules:this.orchestrator.modules()
    };

  }


}
