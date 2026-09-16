export class EventStream {

 publish(event:any){

   return {
    event,
    status:"published"
   };

 }

}
