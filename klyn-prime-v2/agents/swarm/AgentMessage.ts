export interface AgentMessage {

 id:string;

 from:string;

 to:string;

 type:string;

 payload:any;

 timestamp:number;

}


export class MessageFactory {


 static create(
   from:string,
   to:string,
   type:string,
   payload:any
 ):AgentMessage {


   return {

    id:crypto.randomUUID(),

    from,

    to,

    type,

    payload,

    timestamp:Date.now()

   };


 }


}
