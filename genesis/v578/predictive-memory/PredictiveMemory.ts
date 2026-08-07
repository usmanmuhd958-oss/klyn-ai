export class PredictiveMemory {
  store(pattern:any){
    return {
      pattern,
      predictive:true
    };
  }
}
