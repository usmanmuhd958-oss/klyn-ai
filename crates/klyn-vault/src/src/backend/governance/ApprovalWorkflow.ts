export class ApprovalWorkflow {


 requestApproval(task:any){

  return {

   task,

   status:"APPROVED"

  };

 }


}
