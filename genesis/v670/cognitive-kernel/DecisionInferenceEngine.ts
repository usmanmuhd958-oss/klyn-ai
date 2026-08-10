export class DecisionInferenceEngine {

  infer(data:any){
    return {
      data,
      inferenceGenerated:true
    };
  }

}
