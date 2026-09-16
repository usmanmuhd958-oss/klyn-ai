export class DeploymentAutomationBrain {

  deploy(environment:any){
    return {
      status:"deployment_automation_active",
      environment
    };
  }

}
