export class LearningFeedbackCoordinator {

  process(feedback:any){
    return {
      feedback,
      processed:true
    };
  }

}
