import {MetricsEngine} from "./MetricsEngine.js";
import {TraceCollector} from "./TraceCollector.js";
import {HealthAnalyzer} from "./HealthAnalyzer.js";
import {PerformanceIntelligence} from "./PerformanceIntelligence.js";
import {RuntimeAnalytics} from "./RuntimeAnalytics.js";


export class OperationsController {


  metrics=new MetricsEngine();

  traces=new TraceCollector();

  health=new HealthAnalyzer();

  performance=new PerformanceIntelligence();

  analytics=new RuntimeAnalytics();



  inspect(data:any){

    this.metrics.record(data);

    const health =
      this.health.analyze(data);


    const performance =
      this.performance.analyze(
        this.metrics.collect()
      );


    return this.analytics.summarize({
      health,
      performance
    });

  }


}
