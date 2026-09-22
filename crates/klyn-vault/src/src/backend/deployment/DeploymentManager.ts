import { DeploymentPipeline } from "./DeploymentPipeline.js";
import { HealthDeploymentChecker } from "./HealthDeploymentChecker.js";
import { RollbackManager } from "./RollbackManager.js";


export class DeploymentManager {


 pipeline =
  new DeploymentPipeline();


 health =
  new HealthDeploymentChecker();


 rollback =
  new RollbackManager();



 deploy(version:string){

  const result =
   this.pipeline.execute(version);


  const status =
   this.health.verify();


  if(!status.healthy){

   return this.rollback.rollback(version);

  }


  return {

   deployment:result,

   health:status

  };


 }


}
