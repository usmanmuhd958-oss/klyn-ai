import { ToolDefinition }
from "./ToolDefinition";


export class ToolRegistry {

 private tools =
   new Map<string,ToolDefinition>();


 register(tool:ToolDefinition){

   this.tools.set(
    tool.name,
    tool
   );

 }


 execute(
  name:string,
  input:any
 ){

  const tool =
    this.tools.get(name);


  if(!tool){

    return {
      error:"tool-not-found"
    };

  }


  return tool.execute(input);

 }


 list(){

  return [
   ...this.tools.keys()
  ];

 }

}
