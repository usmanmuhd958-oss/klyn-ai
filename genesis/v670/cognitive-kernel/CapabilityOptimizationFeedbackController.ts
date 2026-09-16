export class CapabilityOptimizationFeedbackController {
  optimize(capability:any){
    return {
      capability,
      optimized:true
    };
  }
}
