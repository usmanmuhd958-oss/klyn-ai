export class DistributedTracer {

 trace(operation:string){
   return {
    operation,
    traceId:crypto.randomUUID()
   };
 }

}
