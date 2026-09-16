import {RuntimeRegistry} from "./RuntimeRegistry.js";
import {IntelligenceRegistry} from "./IntelligenceRegistry.js";
import {ModuleHealthManager} from "./ModuleHealthManager.js";


export class UnifiedRuntimeController {


 runtime=new RuntimeRegistry();

 intelligence=new IntelligenceRegistry();

 health=new ModuleHealthManager();



 initialize(){

   return {

     runtime:
       this.runtime.list(),

     intelligence:
       this.intelligence.get(),

     health:
       this.health.check([]),

     status:"KLYN unified runtime active"

   };

 }


}
