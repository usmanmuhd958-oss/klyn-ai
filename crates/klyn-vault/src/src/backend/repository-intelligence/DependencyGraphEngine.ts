export class DependencyGraphEngine {


 build(files:string[]){

  return {

   nodes:files.length,

   edges:[]

  };


 }


}
