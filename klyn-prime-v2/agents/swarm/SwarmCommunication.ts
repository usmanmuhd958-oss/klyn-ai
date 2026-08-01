import { AgentMessage } from "./AgentMessage";


export class SwarmCommunication {


 private messages:AgentMessage[]=[];


 send(message:AgentMessage){

   this.messages.push(message);

 }


 receive(){

   return this.messages;

 }


}
