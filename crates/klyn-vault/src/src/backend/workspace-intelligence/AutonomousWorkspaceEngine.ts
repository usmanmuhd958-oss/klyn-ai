import {GoalPlanner} from "./GoalPlanner.js";
import {ReasoningLoop} from "./ReasoningLoop.js";
import {LearningFeedback} from "./LearningFeedback.js";


export class AutonomousWorkspaceEngine {


  planner = new GoalPlanner();

  reasoning = new ReasoningLoop();

  learning = new LearningFeedback();



  run(goal:any){

    const plan =
      this.planner.plan(goal);


    const reasoning =
      this.reasoning.reason(plan);


    return this.learning.evaluate({
      plan,
      reasoning
    });

  }

}
