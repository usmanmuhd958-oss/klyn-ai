export class OptimizationCore {
  optimize(system:string){
    return {
      system,
      optimized:true,
      status:"improved"
    };
  }
}
