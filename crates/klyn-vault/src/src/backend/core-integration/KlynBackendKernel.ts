import { BackendSystemRegistry } from "./BackendSystemRegistry.js";
import { RuntimeOrchestrator } from "./RuntimeOrchestrator.js";


export class KlynBackendKernel {

 registry =
  new BackendSystemRegistry();


 runtime =
  new RuntimeOrchestrator();


 boot(){

  return {

   runtime:this.runtime.start(),

   systems:this.registry.getModules(),

   kernel:"ONLINE"

  };

 }


}
