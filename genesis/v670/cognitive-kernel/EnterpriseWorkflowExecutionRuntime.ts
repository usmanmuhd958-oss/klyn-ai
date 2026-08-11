export class EnterpriseWorkflowExecutionRuntime {
  run(workflow:any){
    return {
      workflow,
      running:true
    };
  }
}
