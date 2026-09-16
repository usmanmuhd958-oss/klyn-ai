export class SLOManager {

  define(service:string,target:number){
    return {
      service,
      availabilityTarget: target,
      status:"configured"
    };
  }

}
