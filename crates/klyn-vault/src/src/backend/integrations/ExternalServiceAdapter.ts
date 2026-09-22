export class ExternalServiceAdapter {

 adapt(service:string){

  return {
   service,
   adapter:"READY"
  };

 }

}
