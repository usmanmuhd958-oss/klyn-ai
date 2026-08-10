import { AgentBus }
from "./AgentBus";

import { AgentRegistry }
from "./AgentRegistry";


export class AgentOrchestrator {

 private bus =
   new AgentBus();


 constructor(
  private registry:AgentRegistry
 ){}


 dispatch(message:any){

   this.bus.send(message);

   const agent =
     this.registry.get(message.to);


   if(!agent){

    return {
      status:"agent-not-found"
    };

   }


   return agent.execute(
     message.payload
   );

 }


}
