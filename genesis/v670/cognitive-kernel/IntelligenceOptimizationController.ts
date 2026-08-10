export class IntelligenceOptimizationController {

  optimize(system:any){
    return {
      status:"intelligence_optimized",
      system
    };
  }

}
