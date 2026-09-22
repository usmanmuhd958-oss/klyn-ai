import {AgentWorkspaceBridge} from "./AgentWorkspaceBridge.js";


export class WorkspaceAgentOrchestrator {


  bridge=new AgentWorkspaceBridge();


  attach(agent:any, workspace:any){

    return this.bridge.connect(
      agent,
      workspace
    );

  }


  execute(task:any){

    return {

      executed:true,

      task

    };

  }


}
