import { AgentPlanner } from "./AgentPlanner.js";
import { AgentExecutor } from "./AgentExecutor.js";


export class AgentRuntimeEngine {


 planner =
  new AgentPlanner();


 executor =
  new AgentExecutor();



 run(goal:any){

  const plan =
   this.planner.createPlan(goal);


  return this.executor.execute(plan);

 }


}
