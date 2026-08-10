export class MetricsEngine {

 collect(metric:string,value:any){

   return {
    metric,
    value,
    collected:true
   };

 }

}
