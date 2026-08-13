import {RuntimeBootstrap} from "./RuntimeBootstrap.js";
import {ArchitectureHealth} from "./ArchitectureHealth.js";


export class BackendKernelController {


  runtime = new RuntimeBootstrap();

  health = new ArchitectureHealth();


  boot(){

    return {

      runtime:this.runtime.start(),

      health:this.health.check()

    };

  }


}
