export class CapabilityGrowthEngine {
  grow(feature:string){
    return {
      status:"grown",
      feature
    };
  }
}
