import { MetricsCollector } from "./MetricsCollector.js";
import { RuntimeTracer } from "./RuntimeTracer.js";
import { HealthMonitor } from "./HealthMonitor.js";


export class ObservabilityHub {


 metrics =
  new MetricsCollector();


 tracer =
  new RuntimeTracer();


 health =
  new HealthMonitor();



 status(){

  return {

   metrics:this.metrics.snapshot(),

   health:this.health.check()

  };


 }


}
