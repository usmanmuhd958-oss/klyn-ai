import {AgentCoordinator} from "./AgentCoordinator.js";
import {AgentRoleManager} from "./AgentRoleManager.js";


export class MultiAgentOrchestrator {


  coordinator = new AgentCoordinator();

  roles = new AgentRoleManager();



  execute(task:any){

    const assignment =
      this.coordinator.coordinate(task);


    return {

      agents:true,

      assignment

    };

  }


}
