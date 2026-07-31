/**
 * KLYN Prime Agent Message Fabric
 *
 * Communication layer for autonomous agent collaboration.
 */


export type MessageType =
    | "task"
    | "result"
    | "feedback"
    | "knowledge"
    | "alert";




export interface AgentMessage {

    id:string;

    from:string;

    to:string;

    type:MessageType;

    payload:any;

    timestamp:number;

}






export class AgentMessageBus {


    private messages:
        AgentMessage[];




    constructor(){

        this.messages=[];

        console.log(
            "[KLYN MESSAGE FABRIC] Online"
        );

    }







    send(
        message:AgentMessage
    ){

        this.messages.push(
            message
        );

    }







    receive(
        agentId:string
    )
    :
    AgentMessage[] {


        return this.messages.filter(
            message =>
            message.to === agentId
        );


    }







    broadcast(
        from:string,
        payload:any
    ){


        const message:AgentMessage = {


            id:
            crypto.randomUUID(),


            from,


            to:
            "swarm",


            type:
            "knowledge",


            payload,


            timestamp:
            Date.now()


        };


        this.messages.push(
            message
        );


    }







    history(){

        return this.messages;

    }



}
