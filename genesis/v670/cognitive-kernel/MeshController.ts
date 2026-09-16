import {AgentNetwork} from "./AgentNetwork";
import {AgentDiscovery} from "./AgentDiscovery";
import {AgentConsensus} from "./AgentConsensus";

export class MeshController {

 network=new AgentNetwork();
 discovery=new AgentDiscovery();
 consensus=new AgentConsensus();

 execute(task:any){

   const agents=this.discovery.discover(
     this.network.list()
   );

   return {
     task,
     agents,
     consensus:this.consensus.decide(
       [task]
     )
   };

 }

}
