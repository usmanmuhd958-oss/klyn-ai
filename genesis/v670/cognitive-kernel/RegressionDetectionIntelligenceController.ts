export class RegressionDetectionIntelligenceController {
  detect(change:any){
    return {
      change,
      regression:false
    };
  }
}
