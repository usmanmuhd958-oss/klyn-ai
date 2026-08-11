export class ReleaseRiskAssessmentController {
  assess(change:any){
    return {
      change,
      risk:"evaluated"
    };
  }
}
