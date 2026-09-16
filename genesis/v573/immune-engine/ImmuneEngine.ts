export class ImmuneEngine {
  respond(threat:any){
    return {
      threat,
      response:"activated"
    };
  }
}
