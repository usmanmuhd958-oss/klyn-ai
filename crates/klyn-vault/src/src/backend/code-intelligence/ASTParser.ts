export class ASTParser {


 parse(code:string){

  return {

   nodes:code.split("\n").length,

   parsed:true

  };

 }


}
