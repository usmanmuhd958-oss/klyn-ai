export class RuntimeLearningCoordinator {

  learn(event:any){
    return {
      status:"learning",
      event
    };
  }

}
