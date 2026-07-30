export type SystemCapability = {
  name: string;
  level: number;
  status: "active" | "degraded" | "offline";
};


export type SystemGoal = {
  id: string;
  objective: string;
  priority: number;
};


export class SelfModel {

  private capabilities: SystemCapability[] = [];

  private goals: SystemGoal[] = [];


  registerCapability(
    capability: SystemCapability
  ) {
    this.capabilities.push(capability);
  }


  addGoal(goal: SystemGoal) {
    this.goals.push(goal);
  }


  understandState() {

    return {
      capabilities: this.capabilities,
      goals: this.goals,
      timestamp: Date.now()
    };

  }


  findWeaknesses() {

    return this.capabilities.filter(
      c => c.level < 50
    );

  }

}
