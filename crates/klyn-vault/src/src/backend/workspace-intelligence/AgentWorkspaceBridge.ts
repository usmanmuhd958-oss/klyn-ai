export class AgentWorkspaceBridge {


  connect(agent:any, workspace:any){

    return {

      connected:true,

      agent,

      workspace

    };

  }


}
