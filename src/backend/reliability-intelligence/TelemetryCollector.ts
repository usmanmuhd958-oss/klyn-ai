export class TelemetryCollector {


  collect(data:any){

    return {

      data,

      telemetry:"collected"

    };

  }


}
