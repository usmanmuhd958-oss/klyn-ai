export class ServiceOrchestrator {

  services:string[] = [];

  register(service:string){
    this.services.push(service);
  }

  list(){
    return this.services;
  }

}
