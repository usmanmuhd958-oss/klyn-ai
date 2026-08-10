import { ToolDefinition }
from "./ToolDefinition";


export const BuiltinTools:
ToolDefinition[] = [

{
 name:"echo",

 description:"basic response tool",

 execute(input){

   return {
    output:input
   };

 }

}

];
