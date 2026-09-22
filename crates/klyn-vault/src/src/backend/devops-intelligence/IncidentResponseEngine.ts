export class IncidentResponseEngine {

  handle(event:any){

    return {
      event,
      response:"generated",
      recovery:"planned"
    };

  }

}
