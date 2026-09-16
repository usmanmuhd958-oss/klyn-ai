import { MetricsEngine } from "./MetricsEngine";
import { TraceEngine } from "./TraceEngine";
import { EventStream } from "./EventStream";
import { AnalyticsEngine } from "./AnalyticsEngine";

export class ObservabilityController {

 observe(component:string){

   const metrics =
    new MetricsEngine()
    .collect(component,"healthy");

   const trace =
    new TraceEngine()
    .trace(component);

   const event =
    new EventStream()
    .publish(trace);

   return new AnalyticsEngine()
    .analyze({
      metrics,
      event
    });

 }

}
