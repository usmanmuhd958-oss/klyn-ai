export class MultiHopReasoningController {

  analyze(path:string[]){
    return {
      path,
      hops:path.length,
      analysisComplete:true
    };
  }

}
