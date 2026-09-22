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
