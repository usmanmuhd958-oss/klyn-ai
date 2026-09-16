export class WorkflowExecutionEngine {

 execute(task:string){

  return {
   task,
   status:"executed"
  };

 }

}
