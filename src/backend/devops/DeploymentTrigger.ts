export class DeploymentTrigger {

 trigger(version:string){

  return {
   deploymentStarted:true,
   version
  };

 }

}
