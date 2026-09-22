import { EventBus } from "./EventBus.js";
import { BackendEvent } from "./EventTypes.js";


export class EventDispatcher {

 constructor(
  private bus=new EventBus()
 ){}


 dispatch(event:BackendEvent){

   return this.bus.publish(event);

 }


 getBus(){

   return this.bus;

 }

}
