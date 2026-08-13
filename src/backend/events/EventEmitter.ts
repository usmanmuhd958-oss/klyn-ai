import { BackendEvent } from "./EventTypes.js";


export class EventEmitter {

 private listeners =
 new Map<string,Function[]>();


 on(event:string,callback:Function){

   const handlers =
   this.listeners.get(event) || [];

   handlers.push(callback);

   this.listeners.set(event,handlers);

 }


 emit(event:BackendEvent){

   const handlers =
   this.listeners.get(event.type) || [];


   for(const handler of handlers){

     handler(event);

   }

 }

}
