import {DeploymentAgent} from "./DeploymentAgent";

export class AutonomousDevOpsController {

 private deployer=new DeploymentAgent();

 status(){

  return {
   layer:"autonomous-devops",
   deployment:"online",
   automation:"active"
  };

 }

}
