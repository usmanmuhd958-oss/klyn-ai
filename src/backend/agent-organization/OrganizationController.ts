import {AgentRegistry} from "./AgentRegistry.js";
import {AgentRoleManager} from "./AgentRoleManager.js";
import {AgentCommunicationBus} from "./AgentCommunicationBus.js";
import {AgentDelegationEngine} from "./AgentDelegationEngine.js";


export class OrganizationController {


 registry=new AgentRegistry();

 roles=new AgentRoleManager();

 communication=new AgentCommunicationBus();

 delegation=new AgentDelegationEngine();



 execute(request:any){

   return {

     delegation:
       this.delegation.delegate(request.task),

     communication:
       this.communication.send(request.message),

     agents:
       this.registry.list()

   };

 }


}
