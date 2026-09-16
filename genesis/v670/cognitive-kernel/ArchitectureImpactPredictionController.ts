export class ArchitectureImpactPredictionController {
  predict(change:any){
    return {
      change,
      impact:"analyzed"
    };
  }
}
