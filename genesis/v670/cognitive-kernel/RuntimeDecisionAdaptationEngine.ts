export class RuntimeDecisionAdaptationEngine {

  adapt(signal:any){
    return {
      signal,
      adaptationCompleted:true
    };
  }

}
