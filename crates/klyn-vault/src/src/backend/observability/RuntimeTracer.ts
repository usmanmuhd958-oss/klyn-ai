export class RuntimeTracer {


 trace(event:string){

  return {

   event,

   timestamp:Date.now()

  };

 }


}
