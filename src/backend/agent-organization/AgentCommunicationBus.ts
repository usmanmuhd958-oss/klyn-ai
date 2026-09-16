export class AgentCommunicationBus {


  send(message:any){

    return {

      message,

      delivered:true

    };

  }


}
