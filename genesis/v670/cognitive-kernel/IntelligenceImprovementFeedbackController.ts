export class IntelligenceImprovementFeedbackController {
  analyze(feedback:any){
    return {
      feedback,
      improvement:"planned"
    };
  }
}
