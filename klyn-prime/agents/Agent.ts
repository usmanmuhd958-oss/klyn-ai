export interface AgentCapability {
  name: string;
  description: string;
}


export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
}


export class Agent {

  identity: AgentIdentity;
  capabilities: AgentCapability[];

  constructor(
    identity: AgentIdentity,
    capabilities: AgentCapability[]
  ){
    this.identity = identity;
    this.capabilities = capabilities;
  }


  execute(task:string){

    return {
      agent:this.identity.name,
      task,
      status:"completed"
    };

  }

}
