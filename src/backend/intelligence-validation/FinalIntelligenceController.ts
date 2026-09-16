import {SystemValidator} from "./SystemValidator.js";
import {ArchitectureValidator} from "./ArchitectureValidator.js";
import {IntelligenceHealthMonitor} from "./IntelligenceHealthMonitor.js";
import {RuntimeReadinessChecker} from "./RuntimeReadinessChecker.js";


export class FinalIntelligenceController {


 system=new SystemValidator();

 architecture=new ArchitectureValidator();

 health=new IntelligenceHealthMonitor();

 runtime=new RuntimeReadinessChecker();



 validate(){

   return {

     system:this.system.validate(),

     architecture:this.architecture.check(),

     intelligence:this.health.monitor(),

     runtime:this.runtime.check()

   };

 }


}
