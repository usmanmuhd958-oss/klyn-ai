export class AgentMessageBus {


  private messages:any[]=[];


  send(message:any){

    this.messages.push(message);

    return message;

  }


  receive(){

    return this.messages;

  }


}
