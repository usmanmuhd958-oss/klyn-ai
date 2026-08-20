export interface RuntimeTask {
  id: string;

  goal: string;

  status:
    | "created"
    | "planning"
    | "executing"
    | "verifying"
    | "completed"
    | "failed";

  createdAt: Date;
}


export class AutonomousRuntime {

  private tasks: RuntimeTask[] = [];


  createTask(
    goal: string
  ): RuntimeTask {

    const task: RuntimeTask = {
      id: crypto.randomUUID(),

      goal,

      status: "created",

      createdAt: new Date()
    };


    this.tasks.push(task);

    return task;
  }


  updateStatus(
    id: string,
    status: RuntimeTask["status"]
  ): void {

    const task =
      this.tasks.find(
        item => item.id === id
      );


    if (task) {
      task.status = status;
    }
  }


  getTasks(): RuntimeTask[] {

    return this.tasks;
  }
}
