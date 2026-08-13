import {HealthMonitor} from "./HealthMonitor.js";
import {TelemetryCollector} from "./TelemetryCollector.js";
import {FailureAnalyzer} from "./FailureAnalyzer.js";
import {RecoveryManager} from "./RecoveryManager.js";


export class ReliabilityController {


 health = new HealthMonitor();

 telemetry = new TelemetryCollector();

 analyzer = new FailureAnalyzer();

 recovery = new RecoveryManager();



 inspect(input:any){

   return {

     health:
       this.health.check(input.service),

     telemetry:
       this.telemetry.collect(input.metrics),

     failure:
       this.analyzer.analyze(input.event),

     recovery:
       this.recovery.recover(input.issue)

   };

 }


}
