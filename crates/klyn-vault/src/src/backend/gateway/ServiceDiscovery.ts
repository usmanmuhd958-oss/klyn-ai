export class ServiceDiscovery {


 private services =
  new Map<string,string>();


 register(
  name:string,
  endpoint:string
 ){

  this.services.set(
   name,
   endpoint
  );

 }


 discover(name:string){

  return this.services.get(name);

 }


}
