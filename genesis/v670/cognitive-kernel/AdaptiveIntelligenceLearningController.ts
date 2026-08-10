export class AdaptiveIntelligenceLearningController {

  learn(signal:string){
    return {
      signal,
      adapted:true
    };
  }

}
