import { WorkflowPlanner }
from "./WorkflowPlanner";


export class WorkflowEngine {

 private planner =
  new WorkflowPlanner();


 run(goal:string){

   const workflow =
    this.planner.create(goal);


   workflow.status =
    "completed";


   return {

    workflow,

    engine:
    "KLYN Workflow Engine V708"

   };

 }

}
