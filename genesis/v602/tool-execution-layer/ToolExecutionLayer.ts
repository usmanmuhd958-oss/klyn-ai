export class ToolExecutionLayer {

 execute(tool:any,input:any){

  return {
   tool,
   executed:true,
   input
  };

 }

}
