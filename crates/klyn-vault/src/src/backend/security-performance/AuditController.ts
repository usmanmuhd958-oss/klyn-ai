import {SecurityScanner} from "./SecurityScanner.js";
import {PerformanceProfiler} from "./PerformanceProfiler.js";
import {ResourceMonitor} from "./ResourceMonitor.js";


export class AuditController {


 security=new SecurityScanner();

 performance=new PerformanceProfiler();

 resources=new ResourceMonitor();



 audit(input:any){

   return {

     security:
       this.security.scan(input.system),

     performance:
       this.performance.profile(input.system),

     resources:
       this.resources.monitor(input.resources),

     status:"audit-complete"

   };

 }


}
