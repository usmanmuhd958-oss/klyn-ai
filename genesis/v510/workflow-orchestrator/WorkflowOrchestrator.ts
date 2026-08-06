export class WorkflowOrchestrator {

 execute(flow:string){

  return {
   flow,
   status:"orchestration started"
  };

 }

}
