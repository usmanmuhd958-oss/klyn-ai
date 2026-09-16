import { AgentMessage }
from "./AgentMessage";


export class AgentBus {

 private queue:AgentMessage[] = [];


 send(message:AgentMessage){

   this.queue.push(message);

 }


 receive(){

   return this.queue.shift();

 }


 pending(){

   return this.queue.length;

 }

}
