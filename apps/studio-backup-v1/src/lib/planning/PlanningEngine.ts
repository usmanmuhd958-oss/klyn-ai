
import type {
  ExecutionGraph,
  PlanningTask,
  AgentRole,
} from "@/components/planner/planner.types";


function id(prefix:string){
 return `${prefix}-${Date.now()}-${Math.random()
 .toString(36)
 .slice(2,8)}`;
}


export class PlanningEngine {

  createPlan(intent:string):ExecutionGraph {

    const tasks:PlanningTask[]=[
      {
        id:id("task"),
        title:"Analyze requirement",
        description:intent,
        dependencies:[],
        assignedAgent:"planner",
        status:"analyzing",
        risk:10
      },
      {
        id:id("task"),
        title:"Design architecture",
        description:"Generate system architecture",
        dependencies:[],
        assignedAgent:"architect",
        status:"pending",
        risk:25
      },
      {
        id:id("task"),
        title:"Implementation",
        description:"Generate production code",
        dependencies:[],
        assignedAgent:"coder",
        status:"pending",
        risk:40
      },
      {
        id:id("task"),
        title:"Validation",
        description:"Run tests and verification",
        dependencies:[],
        assignedAgent:"tester",
        status:"pending",
        risk:20
      }
    ];


    return {
      id:id("plan"),
      intent,
      tasks,
      createdAt:Date.now()
    };

  }


  assignAgent(task:PlanningTask):AgentRole{

    if(task.assignedAgent)
      return task.assignedAgent;

    return "coder";

  }

}

