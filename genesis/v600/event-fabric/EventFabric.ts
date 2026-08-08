export class EventFabric {

 emit(event:any){

  return {
   event,
   timestamp:Date.now()
  };

 }

}
