type Handler = (
 data:any
)=>void;



export class NexusBus {


 private listeners:
 Map<string,Handler[]>;



 constructor(){

  this.listeners = new Map();

 }



 initialize(){

  console.log(
   "[NEXUS BUS] ONLINE"
  );

 }



 subscribe(
  event:string,
  handler:Handler
 ){

  if(!this.listeners.has(event)){
    this.listeners.set(
      event,
      []
    );
  }


  this.listeners
  .get(event)!
  .push(handler);

 }



 publish(
  event:string,
  payload:any
 ){

  const handlers =
  this.listeners.get(event)||[];


  for(
   const handler of handlers
  ){

    handler(payload);

  }


 }



}
