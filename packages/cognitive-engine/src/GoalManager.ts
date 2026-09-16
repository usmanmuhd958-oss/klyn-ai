export interface Goal {
  id: string;
  description: string;
  priority: number;
  status: "pending" | "active" | "completed";
  tasks: string[];
  createdAt: Date;
}

export class GoalManager {
  private goals: Goal[] = [];

  createGoal(description: string): Goal {
    const goal: Goal = {
      id: crypto.randomUUID(),
      description,
      priority: 1,
      status: "pending",
      tasks: [],
      createdAt: new Date(),
    };

    this.goals.push(goal);

    return goal;
  }

  addTask(goalId: string, task: string): void {
    const goal = this.goals.find(
      (item) => item.id === goalId
    );

    if (!goal) {
      throw new Error("Goal not found");
    }

    goal.tasks.push(task);
  }

  activateGoal(goalId: string): void {
    const goal = this.goals.find(
      (item) => item.id === goalId
    );

    if (!goal) {
      throw new Error("Goal not found");
    }

    goal.status = "active";
  }

  getGoals(): Goal[] {
    return this.goals;
  }
}
