export interface AgentMessage {

 from:string;

 to:string;

 message:string;

}


export class AgentCommunicationBus {


 private messages:AgentMessage[]=[];


 send(message:AgentMessage){

  this.messages.push(message);

 }


 receive(){

  return this.messages;

 }


}
