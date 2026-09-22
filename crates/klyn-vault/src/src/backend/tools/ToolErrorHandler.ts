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
