export class HealthMonitor {


  check(service:any){

    return {

      service,

      health:"healthy",

      checked:true

    };

  }


}
