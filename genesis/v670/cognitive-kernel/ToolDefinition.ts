export interface ToolDefinition {

 name:string;

 description:string;

 execute:
 (input:any)=>any;

}
