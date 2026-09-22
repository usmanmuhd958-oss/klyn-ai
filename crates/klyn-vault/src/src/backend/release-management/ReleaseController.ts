import {ReleaseRegistry} from "./ReleaseRegistry.js";
import {SystemStatusChecker} from "./SystemStatusChecker.js";
import {ReadinessReport} from "./ReadinessReport.js";


export class ReleaseController {


 release=new ReleaseRegistry();

 system=new SystemStatusChecker();

 report=new ReadinessReport();



 validate(){

   const status =
     this.system.check();


   return {

     release:
       this.release.info(),

     report:
       this.report.generate(status)

   };

 }


}
