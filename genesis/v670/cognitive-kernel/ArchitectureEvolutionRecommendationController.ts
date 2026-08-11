export class ArchitectureEvolutionRecommendationController {
  recommend(change:any){
    return {
      change,
      recommendation:"created"
    };
  }
}
