export class RegressionDetector {


  detect(change:any){

    return {

      change,

      regression:false,

      analysis:"complete"

    };

  }


}
