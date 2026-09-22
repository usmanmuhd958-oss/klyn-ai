import {WorkspaceAPI} from "./WorkspaceAPI.js";
import {AgentAPI} from "./AgentAPI.js";
import {MemoryAPI} from "./MemoryAPI.js";
import {ReasoningAPI} from "./ReasoningAPI.js";
import {EngineeringAPI} from "./EngineeringAPI.js";


export class IntelligenceGateway {


 workspace=new WorkspaceAPI();

 agent=new AgentAPI();

 memory=new MemoryAPI();

 reasoning=new ReasoningAPI();

 engineering=new EngineeringAPI();


 status(){

   return {

     gateway:"online",

     intelligence:"connected"

   };

 }


}
