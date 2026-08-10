export class EnterpriseTelemetryIntelligenceEngine {

  collect(source:string){
    return {
      source,
      telemetry:"captured"
    };
  }

}
