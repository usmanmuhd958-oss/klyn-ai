import { BackendEvent } from "./EventTypes.js";


export class AsyncEventProcessor {


 async process(
   event:BackendEvent
 ){

   return {

    processed:true,

    type:event.type

   };

 }


}
