export class AgentNegotiationProtocol {

 negotiate(task:any, agents:any[]){
   return {
    task,
    participants:agents,
    agreement:"generated"
   };
 }

}
