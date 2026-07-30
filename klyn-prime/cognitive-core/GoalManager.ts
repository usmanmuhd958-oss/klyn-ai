export interface Goal {
  id: string;
  description: string;
  priority: number;
}

export class GoalManager {
  private goals: Goal[] = [];

  addGoal(goal: Goal) {
    this.goals.push(goal);
  }

  getHighestPriority() {
    return this.goals.sort(
      (a,b)=> b.priority - a.priority
    )[0];
  }

  listGoals() {
    return this.goals;
  }
}
