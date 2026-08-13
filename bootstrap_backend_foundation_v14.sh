#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN BACKEND FOUNDATION V14"
echo " TOOL EXECUTION INTELLIGENCE LAYER"
echo "======================================"

mkdir -p src/backend/tools


cat > src/backend/tools/ToolDefinition.ts <<'TS'
export interface ToolDefinition {

 id:string;

 name:string;

 description:string;

 execute:(input:any)=>Promise<any>;

}
TS



cat > src/backend/tools/ToolRegistry.ts <<'TS'
import { ToolDefinition } from "./ToolDefinition.js";


export class ToolRegistry {

 private tools:ToolDefinition[]=[];


 register(tool:ToolDefinition){

  this.tools.push(tool);

 }


 get(id:string){

  return this.tools.find(
   tool=>tool.id===id
  );

 }


 list(){

  return this.tools;

 }

}
TS



cat > src/backend/tools/ToolSelector.ts <<'TS'
export class ToolSelector {


 select(
  tools:any[],
  intent:string
 ){

  return tools.find(
   tool =>
   intent
   .toLowerCase()
   .includes(
    tool.name.toLowerCase()
   )
  );

 }


}
TS



cat > src/backend/tools/ToolExecutionContext.ts <<'TS'
export interface ToolExecutionContext {

 requestId:string;

 agentId:string;

 timestamp:number;

}
TS



cat > src/backend/tools/ToolResult.ts <<'TS'
export interface ToolResult {

 success:boolean;

 output?:unknown;

 error?:string;

 duration:number;

}
TS



cat > src/backend/tools/ToolExecutor.ts <<'TS'
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
TS



cat > src/backend/tools/ToolErrorHandler.ts <<'TS'
export class ToolErrorHandler {


 handle(error:any){

  return {

   recovered:true,

   message:
    error?.message ||
    "Unknown tool error"

  };

 }


}
TS



cat > src/backend/tools/ToolExecutionEngine.ts <<'TS'
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
TS



echo
echo "======================================"
echo " BACKEND FOUNDATION V14 READY"
echo " TOOL EXECUTION ONLINE"
echo "======================================"

