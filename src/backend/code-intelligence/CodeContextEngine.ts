export class CodeContextEngine {


 buildContext(query:string){

  return {

   query,

   context:"GENERATED"

  };


 }


}
