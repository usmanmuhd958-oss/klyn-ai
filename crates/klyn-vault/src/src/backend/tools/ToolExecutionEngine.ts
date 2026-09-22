import { ToolExecutor } from "./ToolExecutor.js";


export class ToolExecutionEngine {


 private executor =
  new ToolExecutor();


 async run(
  tool:any,
  input:any
 ){

  return this.executor.execute(
   tool,
   input
  );

 }


}
