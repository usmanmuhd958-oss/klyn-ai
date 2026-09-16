export class MarketSignalAnalysisController {
  analyze(signal:any){
    return {
      signal,
      insight:"generated"
    };
  }
}
