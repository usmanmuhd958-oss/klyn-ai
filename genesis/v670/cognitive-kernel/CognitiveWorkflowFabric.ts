export class CognitiveWorkflowFabric {

  process(workflow:any){
    return {
      status:"workflow_processed",
      workflow
    };
  }

}
