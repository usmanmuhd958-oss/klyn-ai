export interface IntelligenceModule {
  name:string;
  execute(input:any):Promise<any>;
}


export class MeshController {

 private modules:
 IntelligenceModule[] = [];


 register(module:IntelligenceModule){

  this.modules.push(module);

 }


 async process(input:any){

  let result=input;

  for(const module of this.modules){

    result =
      await module.execute(result);

  }

  return result;

 }


 listModules(){

  return this.modules.map(
   m=>m.name
  );

 }

}
