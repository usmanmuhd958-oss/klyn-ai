export class ActivityStream {

 record(event:string){

  return {
   event,
   timestamp:Date.now()
  };

 }

}
