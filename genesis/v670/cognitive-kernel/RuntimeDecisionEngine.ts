export class RuntimeDecisionEngine {

  decide(signal:any){
    return {
      decision:"optimized",
      signal
    };
  }

}
