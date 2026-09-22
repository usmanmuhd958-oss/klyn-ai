import { ASTParser } from "./ASTParser.js";
import { SymbolIndexer } from "./SymbolIndexer.js";


export class CodeUnderstandingEngine {


 parser =
  new ASTParser();


 symbols =
  new SymbolIndexer();



 understand(code:string){

  return {

   ast:this.parser.parse(code),

   symbols:this.symbols

  };


 }


}
