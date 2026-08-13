export class QualityAnalyzer {


  analyze(result:any){

    return {

      result,

      quality:"evaluated",

      score:100

    };

  }


}
