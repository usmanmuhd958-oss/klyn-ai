export class NexusRegistry {


 private modules:Map<string,any>;


 constructor(){

  this.modules = new Map();

 }



 register(
  name:string,
  instance:any
 ){

  this.modules.set(
    name,
    instance
  );

 }



 resolve(name:string){

  return this.modules.get(name);

 }



 list(){

  return Array.from(
    this.modules.keys()
  );

 }



 remove(name:string){

  this.modules.delete(name);

 }


}
