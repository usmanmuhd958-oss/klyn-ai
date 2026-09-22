export class ServiceRegistry {

 private services = new Map<string,unknown>();

 register(name:string,service:unknown){
   this.services.set(name,service);
 }

 get(name:string){
   return this.services.get(name);
 }

 list(){
   return [...this.services.keys()];
 }

}
