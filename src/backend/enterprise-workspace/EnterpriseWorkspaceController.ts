import {WorkspaceDashboardAPI} from "./WorkspaceDashboardAPI.js";
import {AgentControlAPI} from "./AgentControlAPI.js";
import {ProjectIntelligenceAPI} from "./ProjectIntelligenceAPI.js";
import {WorkflowControlAPI} from "./WorkflowControlAPI.js";


export class EnterpriseWorkspaceController {


 dashboard=new WorkspaceDashboardAPI();

 agents=new AgentControlAPI();

 projects=new ProjectIntelligenceAPI();

 workflows=new WorkflowControlAPI();



 status(){

   return {

     dashboard:this.dashboard.overview(),

     enterprise:"ready"

   };

 }


}
