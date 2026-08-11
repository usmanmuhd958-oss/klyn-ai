export class EnterpriseAGIResourceCoordinationEngine {
  coordinate(resources:any[]){
    return {
      resources,
      coordinated:true
    };
  }
}
