import {SystemRegistry} from "./SystemRegistry.js";


export class ModuleOrchestrator {

  registry = new SystemRegistry();


  load(name:string, module:any){

    this.registry.register(name,module);

  }


  modules(){

    return this.registry.list();

  }

}
