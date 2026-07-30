type EventHandler = (data:any)=>void;

export class EventBus {

 private listeners: Map<string, EventHandler[]>;

 constructor(){
   this.listeners = new Map();
 }

 on(event:string, handler:EventHandler){

   if(!this.listeners.has(event)){
     this.listeners.set(event,[]);
   }

   this.listeners
   .get(event)!
   .push(handler);
 }


 emit(event:string,data:any){

   const handlers =
   this.listeners.get(event)||[];

   for(const handler of handlers){
     handler(data);
   }
 }

}
