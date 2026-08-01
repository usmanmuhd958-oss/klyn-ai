import { AgentIdentity } from "./AgentIdentity";
import { AgentCapability } from "./AgentCapability";


export class Agent {

  constructor(
    public identity: AgentIdentity,
    public capability: AgentCapability
  ){}


  async execute(task:string){

    if(!this.capability.canExecute(task)){
      throw new Error(
        "Agent capability missing"
      );
    }


    return {
      agent:this.identity.name,
      result:`Executed ${task}`
    };

  }

}
