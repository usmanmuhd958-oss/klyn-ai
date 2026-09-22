export class ObservabilityEngine {

  inspect(system:any){

    return {
      system,
      metrics:"collected",
      health:"healthy"
    };

  }

}
