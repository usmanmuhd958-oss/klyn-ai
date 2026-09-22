export interface ToolDefinition {

 id:string;

 name:string;

 description:string;

 execute:(input:any)=>Promise<any>;

}
