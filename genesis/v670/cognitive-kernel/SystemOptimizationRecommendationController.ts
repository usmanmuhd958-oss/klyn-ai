export class SystemOptimizationRecommendationController {
  recommend(data:any){
    return {
      data,
      recommendations:"generated"
    };
  }
}
