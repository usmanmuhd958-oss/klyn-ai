export class MessageRoutingEngine {

 route(message:string){

  return {
   message,
   routed:true
  };

 }

}
