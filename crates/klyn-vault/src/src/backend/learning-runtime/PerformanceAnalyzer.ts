export class PerformanceAnalyzer {

  analyze(experience:any){

    return {

      score: experience.result?.success ? 1 : 0,

      analyzed:true

    };

  }

}
