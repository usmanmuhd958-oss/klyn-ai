import { CognitiveStateManager } from "./CognitiveState.js";
import { GoalManager } from "./GoalManager.js";
import { PlanningEngine } from "./PlanningEngine.js";
import { ReflectionEngine } from "./ReflectionEngine.js";
import { SelfModelEngine } from "./SelfModel.js";

export class CognitiveKernel {

  public state: CognitiveStateManager;
  public goals: GoalManager;
  public planner: PlanningEngine;
  public reflection: ReflectionEngine;
  public selfModel: SelfModelEngine;

  constructor() {
    this.state = new CognitiveStateManager();
    this.goals = new GoalManager();
    this.planner = new PlanningEngine();
    this.reflection = new ReflectionEngine();
    this.selfModel = new SelfModelEngine();
  }

  initialize(): void {
    this.selfModel.registerCapability({
      name: "cognitive-planning",
      description: "Autonomous planning capability",
      status: "available",
    });

    this.selfModel.registerCapability({
      name: "self-reflection",
      description: "Performance evaluation capability",
      status: "available",
    });
  }

  status() {
    return {
      state: this.state.getState(),
      system: this.selfModel.getModel(),
    };
  }
}
