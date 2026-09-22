import { ToolResult } from "./ToolResult.js";


export class ToolExecutor {


 async execute(
  tool:any,
  input:any
 ):Promise<ToolResult>{

  const start=Date.now();


  try{

   const output =
    await tool.execute(input);


   return {

    success:true,

    output,

    duration:
     Date.now()-start

   };


  }catch(error:any){


   return {

    success:false,

    error:error.message,

    duration:
     Date.now()-start

   };


  }


 }


}
