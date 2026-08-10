export class MultiCloudOrchestrationController {

  orchestrate(clouds:any[]){
    return {
      status:"multi_cloud_orchestration_active",
      clouds
    };
  }

}
