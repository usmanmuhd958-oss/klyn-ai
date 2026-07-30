export interface Message {

  from:string;

  to:string;

  content:string;

}


export class AgentCommunication {


 send(message:Message){

   return {
     delivered:true,
     message
   };

 }


}
