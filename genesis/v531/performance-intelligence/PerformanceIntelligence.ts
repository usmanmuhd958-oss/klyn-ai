
export class PerformanceIntelligence {

 analyze(metrics:any){
   return {
    bottlenecks:[],
    score:metrics?.score ?? 0
   }
 }

}

