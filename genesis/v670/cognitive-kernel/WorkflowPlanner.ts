import { WorkflowTask }
from "./WorkflowTask";


export class WorkflowPlanner {


 create(goal:string):WorkflowTask {

   return {

    id:
    "wf_" + Date.now(),

    goal,

    steps:[
      "analyze",
      "plan",
      "execute",
      "verify"
    ],

    status:"created"

   };

 }

}
