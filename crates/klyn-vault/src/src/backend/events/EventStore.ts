import { BackendEvent } from "./EventTypes.js";


export class EventStore {

 private events:BackendEvent[]=[];


 append(event:BackendEvent){

   this.events.push(event);

 }


 all(){

   return this.events;

 }

}
