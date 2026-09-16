export class CognitiveServiceRegistry {

  services:any[] = [];

  register(service:string){
    this.services.push(service);
    return this.services;
  }

}
