import { DevOpsAgent } from "./DevOpsAgent.js";


export class CICDEngine {


 agent =
  new DevOpsAgent();



 execute(project:string){

  return this.agent.run(project);

 }


}
