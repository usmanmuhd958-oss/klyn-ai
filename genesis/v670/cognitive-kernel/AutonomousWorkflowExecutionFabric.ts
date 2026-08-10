export class AutonomousWorkflowExecutionFabric {

  execute(workflow:string){
    return {
      workflow,
      status:"executing"
    };
  }

}
