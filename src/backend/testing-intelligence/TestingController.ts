import {TestPlanner} from "./TestPlanner.js";
import {QualityAnalyzer} from "./QualityAnalyzer.js";
import {RegressionDetector} from "./RegressionDetector.js";
import {ValidationEngine} from "./ValidationEngine.js";


export class TestingController {


 planner=new TestPlanner();

 quality=new QualityAnalyzer();

 regression=new RegressionDetector();

 validation=new ValidationEngine();



 execute(input:any){

   const plan =
     this.planner.createPlan(input.change);


   const regression =
     this.regression.detect(input.change);


   const quality =
     this.quality.analyze(plan);



   return {

     plan,

     regression,

     quality,

     validation:
       this.validation.validate(input)

   };

 }


}
