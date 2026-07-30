export interface Message {

    from:string;

    to:string;

    payload:any;

}


export class AgentMessageBus {


    private queue:Message[]=[];


    send(message:Message){

        this.queue.push(message);

    }


    receive(){

        return this.queue.shift();

    }


}
