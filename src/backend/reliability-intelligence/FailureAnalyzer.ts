export class FailureAnalyzer {


  analyze(event:any){

    return {

      event,

      failureDetected:false,

      analysis:"complete"

    };

  }


}
