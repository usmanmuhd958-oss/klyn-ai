export class PredictionCore {
  predict(input:any){
    return {
      input,
      prediction:"generated"
    };
  }
}
