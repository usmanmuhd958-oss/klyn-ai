export class WorkflowControlAPI {


 execute(workflow:any){

   return {

     workflow,

     execution:"started"

   };

 }


}
