export class DeploymentPipeline {


 execute(version:string){

  return {

   version,

   stage:"DEPLOYMENT_STARTED"

  };


 }


}
