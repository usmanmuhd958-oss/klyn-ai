export class ServiceOrchestrator {

  services = new Map();

  register(name:string, service:any){

    this.services.set(name, service);

  }


  get(name:string){

    return this.services.get(name);

  }

}
