import {FeedbackProcessor} from "./FeedbackProcessor.js";
import {PerformanceAnalyzer} from "./PerformanceAnalyzer.js";
import {CapabilityOptimizer} from "./CapabilityOptimizer.js";


export class LearningEngine {


 feedback=new FeedbackProcessor();

 analyzer=new PerformanceAnalyzer();

 optimizer=new CapabilityOptimizer();



 learn(data:any){

   const feedback =
     this.feedback.process(data.feedback);


   const performance =
     this.analyzer.analyze(data.metrics);



   const improvement =
     this.optimizer.optimize(data.capability);



   return {

     feedback,

     performance,

     improvement,

     learning:"complete"

   };


 }


}
