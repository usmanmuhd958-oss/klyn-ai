type Handler = (
 data:any
)=>void | Promise<void>;



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



 async publish(
  event:string,
  payload:any
 ):Promise<void>{

  const handlers =
  this.listeners.get(event)||[];


  const results: Promise<void>[] = [];


  for(
   const handler of handlers
  ){

    try{
      const result = handler(payload);
      if (result && typeof result.catch === "function") {
        results.push(
          result.catch((error: Error) => {
            console.error(`[NexusBus] Handler failed for event ${event}:`, error);
          })
        );
      }
    }catch(error){
      console.error(`[NexusBus] Sync handler failed for event ${event}:`, error);
    }

  }


  if (results.length > 0) {
    await Promise.allSettled(results);
  }



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
