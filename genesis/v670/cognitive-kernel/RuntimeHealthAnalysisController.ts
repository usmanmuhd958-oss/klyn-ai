export class RuntimeHealthAnalysisController {

  analyze(runtime:string){
    return {
      runtime,
      health:"stable"
    };
  }

}
