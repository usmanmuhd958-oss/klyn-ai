import { CognitiveTask } from "./types";

export class PlanningEngine {

  createPlan(task: CognitiveTask) {

    return [
      `Understand ${task.goal}`,
      "Architecture planning",
      "Execution",
      "Verification"
    ];

  }

}
