export class AdaptiveFeedbackLoop {
  improve(signal:any){
    return {
      signal,
      adaptation:"triggered"
    };
  }
}
