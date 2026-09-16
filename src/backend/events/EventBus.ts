import { EventEmitter } from "./EventEmitter.js";
import { BackendEvent } from "./EventTypes.js";


export class EventBus {

 private emitter =
 new EventEmitter();


 subscribe(
  type:string,
  handler:Function
 ){

  this.emitter.on(type,handler);

 }


 publish(event:BackendEvent){

  this.emitter.emit(event);

  return {
    published:true,
    event:event.type
  };

 }

}
