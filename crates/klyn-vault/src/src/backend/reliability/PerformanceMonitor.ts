export class PerformanceMonitor {

 measure(operation:string){

  return {
   operation,
   latency:0,
   status:"OK"
  };

 }

}
