export class RuntimeMessageBus {

 publish(event:any){

  return {
   published:true,
   event
  };

 }

}
