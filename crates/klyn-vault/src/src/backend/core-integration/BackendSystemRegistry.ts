export class BackendSystemRegistry {

 private modules:any[] = [];

 register(module:any){

  this.modules.push(module);

  return {
   registered:true,
   module
  };

 }


 getModules(){

  return this.modules;

 }

}
