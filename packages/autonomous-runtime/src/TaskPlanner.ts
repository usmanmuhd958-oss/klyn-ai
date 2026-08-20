export interface PlannedTask {
  id: string;

  description: string;

  priority: number;

  completed: boolean;
}


export interface ExecutionPlan {
  id: string;

  goal: string;

  tasks: PlannedTask[];

  createdAt: Date;
}


export class TaskPlanner {

  createPlan(
    goal: string,
    steps: string[]
  ): ExecutionPlan {

    return {
      id: crypto.randomUUID(),

      goal,

      tasks: steps.map(
        (step, index) => ({
          id: crypto.randomUUID(),

          description: step,

          priority: index + 1,

          completed: false
        })
      ),

      createdAt: new Date()
    };
  }
}
