export class KernelEventBus {

 emit(event:any){

  return {
   event,
   emitted:true
  };

 }

}
