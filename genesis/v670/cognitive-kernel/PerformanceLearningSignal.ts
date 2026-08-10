export class PerformanceLearningSignal {
  generate(metric:string){
    return {
      status:"generated",
      metric
    };
  }
}
