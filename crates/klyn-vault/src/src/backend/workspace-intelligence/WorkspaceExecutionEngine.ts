import {WorkspaceAgentOrchestrator} from "./WorkspaceAgentOrchestrator.js";
import {WorkspaceMemoryConnector} from "./WorkspaceMemoryConnector.js";
import {WorkspaceToolCoordinator} from "./WorkspaceToolCoordinator.js";


export class WorkspaceExecutionEngine {


  agents=new WorkspaceAgentOrchestrator();

  memory=new WorkspaceMemoryConnector();

  tools=new WorkspaceToolCoordinator();



  run(request:any){

    const execution =
      this.agents.execute(request);


    this.memory.store(execution);


    return {

      execution,

      status:"workspace-cycle-complete"

    };

  }


}
