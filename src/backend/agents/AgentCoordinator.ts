import {AgentRegistry} from "./AgentRegistry.js";


export class AgentCoordinator {


 constructor(
  private registry=new AgentRegistry()
 ){}


 getAgents(){

  return this.registry.list();

 }


}
