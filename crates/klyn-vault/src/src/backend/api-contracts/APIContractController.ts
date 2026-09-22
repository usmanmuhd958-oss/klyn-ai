import {WorkspaceAPI} from "./WorkspaceAPI.js";
import {AgentAPI} from "./AgentAPI.js";
import {ProjectAPI} from "./ProjectAPI.js";
import {IntelligenceAPI} from "./IntelligenceAPI.js";
import {EnterpriseAPI} from "./EnterpriseAPI.js";


export class APIContractController {

  workspace=new WorkspaceAPI();

  agents=new AgentAPI();

  projects=new ProjectAPI();

  intelligence=new IntelligenceAPI();

  enterprise=new EnterpriseAPI();



  status(){

    return {

      workspace:
        this.workspace.getWorkspace(),

      agents:
        this.agents.listAgents(),

      projects:
        this.projects.getProjects(),

      enterprise:
        this.enterprise.status()

    };

  }

}
