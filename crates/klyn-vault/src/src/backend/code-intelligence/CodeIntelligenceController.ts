import { CodeUnderstandingEngine } from "./CodeUnderstandingEngine.js";


export class CodeIntelligenceController {


 engine =
  new CodeUnderstandingEngine();



 inspect(code:string){

  return this.engine.understand(code);

 }


}
