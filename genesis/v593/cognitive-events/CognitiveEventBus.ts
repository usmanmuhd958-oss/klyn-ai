export class CognitiveEventBus {

 publish(event:any){

  return {
   event,
   published:true
  };

 }

}
