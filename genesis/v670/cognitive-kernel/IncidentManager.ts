export class IncidentManager {

  create(event:string){
    return {
      incident:event,
      severity:"unknown",
      status:"open"
    };
  }

}
