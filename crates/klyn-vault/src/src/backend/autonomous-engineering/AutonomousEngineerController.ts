import {EngineeringAgent} from "./EngineeringAgent.js";
import {CodePlanningEngine} from "./CodePlanningEngine.js";
import {ChangeExecutionEngine} from "./ChangeExecutionEngine.js";
import {ValidationEngine} from "./ValidationEngine.js";


export class AutonomousEngineerController {


 agent=new EngineeringAgent();

 planner=new CodePlanningEngine();

 executor=new ChangeExecutionEngine();

 validator=new ValidationEngine();



 run(task:any){

   const analysis =
     this.agent.analyze(task);


   const plan =
     this.planner.createPlan(analysis);


   const change =
     this.executor.execute(plan);


   return this.validator.validate(change);

 }


}
