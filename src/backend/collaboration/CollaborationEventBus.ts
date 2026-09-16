export class CollaborationEventBus {


 emit(event:string,data:any){

  return {

   event,

   data

  };

 }


}
