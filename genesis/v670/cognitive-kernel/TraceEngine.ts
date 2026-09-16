export class TraceEngine {

 trace(operation:string){

   return {
    operation,
    traceId:Date.now().toString()
   };

 }

}
