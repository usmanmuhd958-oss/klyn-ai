export class ModuleRegistry {

 modules:any[]=[];

 register(module:any){

  this.modules.push(module);

 }

 list(){

  return this.modules;

 }

}
