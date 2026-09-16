export class ControlPlane {
  manage(service:string){
    return {
      service,
      controlled:true
    };
  }
}
