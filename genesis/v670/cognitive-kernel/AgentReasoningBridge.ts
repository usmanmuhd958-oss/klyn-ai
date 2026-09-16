export class AgentReasoningBridge {

 connect(agent:string){
   return {
     agent,
     reasoning:"connected",
     status:"online"
   };
 }

}
