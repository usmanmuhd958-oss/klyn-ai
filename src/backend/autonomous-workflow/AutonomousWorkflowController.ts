import {DevelopmentPlanner} from "./DevelopmentPlanner.js";
import {CodeExecutionManager} from "./CodeExecutionManager.js";
import {TestAutomationEngine} from "./TestAutomationEngine.js";
import {BuildValidationEngine} from "./BuildValidationEngine.js";


export class AutonomousWorkflowController {


 planner=new DevelopmentPlanner();

 executor=new CodeExecutionManager();

 tester=new TestAutomationEngine();

 validator=new BuildValidationEngine();



 run(goal:string){

   const plan=this.planner.createPlan(goal);


   const execution=this.executor.execute(plan);


   const tests=this.tester.run(execution);


   const validation=this.validator.validate();



   return {

     plan,

     execution,

     tests,

     validation

   };


 }


}
